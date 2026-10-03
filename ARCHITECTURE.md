# Architecture

```text
Trusted operator -> exact schema + consent checks -> HMAC ids -> tenant event store
                                                            -> suppressed publication
Subject erasure -> event deletion + tombstone + publication/replay invalidation
```

The API accepts an exact schema with allowlisted dimensions. Subject and event ids use HMAC-SHA256 with tenant and identifier-kind context. Stored events contain only pseudonyms, event type and region. Invalid batches make no changes. A keyed fingerprint supports batch replay without retaining raw input. Field order is significant in this v1. Erasure removes subject events, retains a pseudonymous tombstone, clears batch replay state and invalidates the latest publication.

Aggregation counts events; release eligibility counts distinct subjects. Repeated events from one person cannot meet the threshold. Consumer reports omit suppressed labels and counts; the trusted publication operator receives suppression metadata. Audit holds the last 100 metadata-only events per tenant. Metrics count requests, errors, ingested/skipped events and suppressed groups.

## Trust and limitations

The shared admin key can operate on all tenants. Tenant maps prevent accidental data mixing; production customer authorization must derive tenant scope from an authenticated identity. The service binds to loopback with local demo defaults.

Pseudonyms permit linkage and do not anonymize data. Small-group suppression is not differential privacy: overlapping reports or before/after erasure comparisons can disclose information. Previously downloaded reports remain outside the service's control. Consent is asserted by a trusted upstream operator. JavaScript does not guarantee request-buffer zeroization. No regulatory compliance guarantee is claimed. Tombstones and all other state disappear on restart, so this v1 cannot uphold durable erasure across restarts.

## Production upgrades

Persist events, deduplication and tombstones transactionally with retention, tenant quotas, admission controls and durable erasure workflows. Protect HMAC keys in managed storage with key ids and rotation; migrate tombstones and deduplication consistently. Add scoped operator and consumer identities, TLS, encrypted storage, rate limits and tenant partitions. Separate ingestion from publication and restrict repeated or overlapping report queries; adopt a reviewed differential privacy mechanism if formal guarantees are needed. Export metadata-only latency, rejection, retention and per-tenant saturation metrics. Replace the in-memory audit with a durable append-only sink. Total retained events and batches need explicit limits before sustained use.
