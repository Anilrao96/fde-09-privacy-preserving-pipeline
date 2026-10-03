# FDE Project 09: Privacy-Preserving Pipeline

A dependency-free Node.js API for consent-aware event ingestion, tenant-specific HMAC pseudonyms, suppressed aggregate reports, and subject erasure. Stored events contain pseudonyms and allowlisted dimensions; raw identifiers are discarded after processing.

## Run

Requires Node.js 20 or later. Run `npm start` to listen on `http://127.0.0.1:3009`. In another terminal run `npm run demo` and `npm test`.

Defaults are local demo credentials. Set `PIPELINE_ADMIN_KEY` and `PIPELINE_HASH_SECRET` before using real data. `MINIMUM_GROUP_SIZE` defaults to 3 (minimum 2). `PORT` overrides 3009; `PIPELINE_URL` changes the demo target. The demo verifies consent filtering, replay, suppression, erasure and publication invalidation.

All routes except `GET /health` require `Authorization: Bearer <PIPELINE_ADMIN_KEY>`.

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/tenants/:tenant/batches` | Ingest a batch atomically |
| POST | `/tenants/:tenant/publications` | Publish a suppressed aggregate snapshot |
| GET | `/tenants/:tenant/publications/latest?dimension=region` | Read a report; `eventType` is also supported |
| POST | `/tenants/:tenant/erase` | Erase a subject and block reingestion |
| GET | `/tenants/:tenant/audit` | Read metadata-only audit events |
| GET | `/metrics` | Read service counters |

Example batch body:

```json
{"batchId":"batch-001","events":[{"id":"event-1","subjectId":"person-1","consent":true,"eventType":"signup","region":"north"}]}
```

Every event must contain exactly these five fields. Event types are `signup`, `purchase`, or `support`; regions are `north`, `south`, `east`, or `west`. Batches accept 1–100 events, identifiers up to 128 characters, and bodies up to 128 KiB. An invalid event rejects the entire batch. Reusing a batch id with identical event JSON returns the original result; changed content returns 409. Nonconsented events, duplicate event ids and erased subjects are skipped. Accepted events invalidate the current publication.

Reports release event counts only for groups containing at least the configured number of distinct subjects. Erasure body is `{"subjectId":"person-1"}`. Erasure removes events, retains a pseudonymous tombstone, clears batch replay records and invalidates publications. Existing client copies cannot be revoked.

State disappears on restart. The shared admin key is a trusted operator credential across tenants; tenant URL selection is not customer authentication. Pseudonymization and suppression do not guarantee anonymity or differential privacy. See [ARCHITECTURE.md](ARCHITECTURE.md) for deployment assumptions and upgrade paths.
