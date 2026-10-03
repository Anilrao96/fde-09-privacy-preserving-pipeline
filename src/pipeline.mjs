import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const DIMENSIONS = ['eventType', 'region'];
const TYPES = new Set(['signup', 'purchase', 'support']);
const REGIONS = new Set(['north', 'south', 'east', 'west']);
const TENANT_RE = /^[a-z][a-z0-9-]{0,39}$/;
const EVENT_KEYS = ['consent', 'eventType', 'id', 'region', 'subjectId'];
const MAX_BODY = 128 * 1024;

function fail(status, code) {
  const error = new Error(code);
  error.status = status;
  return error;
}

function sameSecret(actual, expected) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function token(secret, tenant, kind, value) {
  return createHmac('sha256', secret)
    .update(`${kind}\0${tenant}\0${value}`)
    .digest('hex');
}

function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
      Object.keys(event).sort().join(',') !== EVENT_KEYS.join(',')) throw fail(400, 'invalid_event_schema');
  if (typeof event.id !== 'string' || event.id.length < 1 || event.id.length > 128 ||
      typeof event.subjectId !== 'string' || event.subjectId.length < 1 || event.subjectId.length > 128 ||
      typeof event.consent !== 'boolean' || !TYPES.has(event.eventType) ||
      !REGIONS.has(event.region)) throw fail(400, 'invalid_event_schema');
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw fail(413, 'body_too_large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail(400, 'invalid_json'); }
}

function reply(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(data));
}

export function createService({ adminKey, secret, minimumGroupSize = 3 } = {}) {
  if (!adminKey || !secret || minimumGroupSize < 2 || !Number.isInteger(minimumGroupSize))
    throw new Error('adminKey, secret, and minimumGroupSize >= 2 are required');
  const tenants = new Map();
  const metrics = { requests: 0, errors: 0, ingested: 0, skipped: 0, suppressedGroups: 0 };

  function state(tenant) {
    if (!tenants.has(tenant)) tenants.set(tenant, {
      events: new Map(), tombstones: new Set(), batches: new Map(), publication: null, audit: []
    });
    return tenants.get(tenant);
  }

  function audit(s, action, detail) {
    s.audit.push({ at: new Date().toISOString(), action, ...detail });
    if (s.audit.length > 100) s.audit.shift();
  }

  const server = createServer(async (request, response) => {
    metrics.requests++;
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/health')
        return reply(response, 200, { status: 'ok' });
      const authorization = /^Bearer (.+)$/.exec(request.headers.authorization || '');
      if (!authorization || !sameSecret(authorization[1], adminKey))
        throw fail(401, 'unauthorized');
      if (request.method === 'GET' && url.pathname === '/metrics')
        return reply(response, 200, metrics);

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] !== 'tenants' || !TENANT_RE.test(parts[1] || '')) throw fail(404, 'not_found');
      const tenant = parts[1];
      const s = state(tenant);

      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'batches') {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            Object.keys(body).sort().join(',') !== 'batchId,events' ||
            typeof body.batchId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(body.batchId) ||
            !Array.isArray(body.events) || body.events.length < 1 || body.events.length > 100)
          throw fail(400, 'invalid_batch');
        body.events.forEach(validateEvent);
        const digest = token(secret, tenant, 'batch', JSON.stringify(body.events));
        const previous = s.batches.get(body.batchId);
        if (previous) {
          if (previous.digest !== digest) throw fail(409, 'batch_id_conflict');
          return reply(response, 200, { ...previous.result, replayed: true });
        }
        let accepted = 0, skipped = 0;
        for (const event of body.events) {
          const subject = token(secret, tenant, 'subject', event.subjectId);
          const eventId = token(secret, tenant, 'event', event.id);
          if (!event.consent || s.tombstones.has(subject) || s.events.has(eventId)) { skipped++; continue; }
          s.events.set(eventId, { subject, eventType: event.eventType, region: event.region });
          accepted++;
        }
        if (accepted) s.publication = null;
        metrics.ingested += accepted;
        metrics.skipped += skipped;
        const result = { accepted, skipped };
        s.batches.set(body.batchId, { digest, result });
        audit(s, 'ingest', { accepted, skipped });
        return reply(response, 201, result);
      }

      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'erase') {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            Object.keys(body).join(',') !== 'subjectId' || typeof body.subjectId !== 'string' ||
            body.subjectId.length < 1 || body.subjectId.length > 128) throw fail(400, 'invalid_subject');
        const subject = token(secret, tenant, 'subject', body.subjectId);
        let erased = 0;
        for (const [id, event] of s.events) if (event.subject === subject) { s.events.delete(id); erased++; }
        s.tombstones.add(subject);
        s.publication = null;
        s.batches.clear();
        audit(s, 'erase', { erased });
        return reply(response, 200, { erased });
      }

      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'publications') {
        const groups = Object.fromEntries(DIMENSIONS.map(d => [d, {}]));
        const subjects = Object.fromEntries(DIMENSIONS.map(d => [d, new Map()]));
        for (const event of s.events.values()) for (const dimension of DIMENSIONS) {
          const value = event[dimension];
          groups[dimension][value] = (groups[dimension][value] || 0) + 1;
          if (!subjects[dimension].has(value)) subjects[dimension].set(value, new Set());
          subjects[dimension].get(value).add(event.subject);
        }
        let suppressed = 0;
        for (const dimension of DIMENSIONS) for (const [value, count] of Object.entries(groups[dimension])) {
          if (subjects[dimension].get(value).size < minimumGroupSize) { delete groups[dimension][value]; suppressed++; }
        }
        metrics.suppressedGroups += suppressed;
        s.publication = { publishedAt: new Date().toISOString(), groups };
        audit(s, 'publish', { suppressedGroups: suppressed });
        return reply(response, 201, { publishedAt: s.publication.publishedAt, suppressedGroups: suppressed });
      }

      if (request.method === 'GET' && parts.length === 4 && parts[2] === 'publications' && parts[3] === 'latest') {
        const dimension = url.searchParams.get('dimension');
        if (!DIMENSIONS.includes(dimension) || [...url.searchParams.keys()].some(k => k !== 'dimension'))
          throw fail(400, 'invalid_dimension');
        if (!s.publication) throw fail(404, 'publication_unavailable');
        return reply(response, 200, { dimension, publishedAt: s.publication.publishedAt, groups: s.publication.groups[dimension] });
      }

      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'audit')
        return reply(response, 200, { events: s.audit });
      throw fail(404, 'not_found');
    } catch (error) {
      metrics.errors++;
      reply(response, error.status || 500, { error: error.status ? error.message : 'internal_error' });
    }
  });
  return server;
}
