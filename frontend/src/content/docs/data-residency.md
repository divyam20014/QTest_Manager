# Data Residency

**Status: readiness metadata only. This document describes what a genuine
multi-region deployment would require — it is not an implemented
capability.** See ADR-054 (Tier 4) for the decision record.

## What exists today

- Every tenant has a `data_region` field (`tenants.data_region`, e.g.
  `us`/`eu`/`apac`), settable by a platform administrator at tenant
  creation (`POST /platform/tenants`) or afterward
  (`PATCH /platform/tenants/{id}/data-region`). It is **not** tenant-settable
  — a tenant cannot change its own declared region.
- That is the entire capability. There is one database, one deployment,
  one region, for every tenant regardless of its `data_region` value. The
  field exists so the data model can express an intended assignment ahead
  of any infrastructure that would actually enforce it, and so sales/legal
  conversations about residency have something concrete to point at.

## What a genuine multi-region deployment would require

This is a scoping/estimation reference for a future phase, not a
commitment or a design that has been validated end-to-end.

1. **Per-region database instances.** A tenant's `data_region` would need
   to determine which physical/logical database it's provisioned into —
   this is a much bigger change than the current single-`DATABASE_URL`
   architecture (`app/core/db.py`) supports. Likely shape: one connection
   pool per region, with the application layer routing by `tenant_id` →
   `data_region` → connection pool, resolved once at request-authentication
   time (where `tenant_id` first becomes known) and threaded through the
   rest of the request.
2. **Region-aware request routing.** Either DNS-level routing (different
   regional endpoints, e.g. `eu.qtesthub.example.com`) or an
   application-level router in front of the regional backends. The simpler
   of the two to operate is DNS-level routing with a single frontend that
   knows which backend to proxy to per tenant — but that still needs the
   tenant→region lookup to happen before routing, which usually means a
   lightweight, globally-replicated lookup service or config.
3. **Attachment/object storage residency.** The storage abstraction
   (`app/core/storage.py`) already supports swapping backends via
   `STORAGE_BACKEND`/`S3_*` settings, but today that's one backend for the
   whole deployment. Per-region storage would need a region-keyed registry
   of storage backends, mirroring the database routing above.
4. **Data-transfer and replication constraints.** Background jobs, audit
   log replication (if ever centralized for platform-wide reporting), and
   any future cross-tenant analytics would need explicit per-region
   boundaries — e.g. a platform-wide dashboard must not silently pull EU
   tenant data into a US-hosted aggregation job.
5. **Migration/schema rollout across regions.** Alembic migrations would
   need to run against every regional database, in a coordinated (or at
   least eventually-consistent) way — not a trivial extension of today's
   single-database `alembic upgrade head`.
6. **Backup/restore and disaster recovery per region.** Tier 0's
   `scripts/db_backup.sh`/`db_restore.sh` would need to become per-region,
   with region-scoped retention and restore procedures, since a US outage
   should never require restoring EU data from a US backup (or vice versa).

## Why this wasn't built now

Tier 4's scope was explicitly bounded to what's achievable and verifiable
in this environment. None of the above can be meaningfully implemented or
tested without actual multi-region infrastructure (real regional database
instances, real DNS/routing infra, a real reason a specific customer needs
a specific region) — building a fake version of it would be worse than
documenting the real requirement, since a fake implementation could be
mistaken for a real guarantee a customer is relying on.

## If this becomes a real requirement

Treat it as its own phase with its own approval, not an extension of this
tier. The first real decision needed is *how many regions, and which
ones* — that drives everything else (DNS strategy, number of database
instances to provision, compliance requirements per region such as GDPR
for EU). Don't start on the technical design before that's answered.
