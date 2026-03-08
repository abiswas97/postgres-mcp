# Write Mode Tiers Design

## Problem

The query tool's `validateSqlSafety()` function has a hardcoded "always blocked" list that prevents all DDL operations regardless of configuration. Users who need to run DDL (CREATE TABLE, ALTER TABLE, DROP, TRUNCATE) have no way to enable this.

## Solution

Split the blocked operations into three tiers controlled by environment variables:

### Tier 1: Permanently Blocked (no flag unlocks)

Operations with no legitimate AI-tooling use case:
- GRANT, REVOKE (permission management)
- BACKUP, RESTORE (system-level)
- COPY (file system access)
- ATTACH, DETACH, PRAGMA (SQLite-isms, irrelevant to Postgres)

### Tier 2: DML-gated (`READ_ONLY=false`)

Already partially implemented:
- INSERT, UPDATE, DELETE, MERGE, UPSERT

Existing safety rails remain: UPDATE/DELETE require a valid WHERE clause.

### Tier 3: DDL-gated (`READ_ONLY=false` AND `ALLOW_DDL=true`)

- CREATE, ALTER, DROP, TRUNCATE
- REINDEX, VACUUM, ANALYZE, CLUSTER (maintenance ops)

## New Environment Variable

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOW_DDL` | `false` | Enable DDL operations. No effect unless `READ_ONLY=false`. |

## Design Decisions

- **No new tools** — validation logic change only, existing `query` tool handles all tiers
- **ALLOW_DDL requires READ_ONLY=false** — DDL is a strict superset of write permissions; enabling DDL without DML makes no sense and will be treated as a misconfiguration (DDL still blocked)
- **No transaction support** — explicit BEGIN/COMMIT blocks require stateful connections; out of scope

## TDD Plan

New test file: `tests/unit/tools/query-ddl.test.ts`

1. DDL blocked by default (`READ_ONLY=true`)
2. DDL blocked when `READ_ONLY=false` but `ALLOW_DDL` not set
3. DDL blocked when only `ALLOW_DDL=true` but `READ_ONLY=false` not set
4. DDL allowed when `READ_ONLY=false` AND `ALLOW_DDL=true`
5. Permanently blocked ops still blocked regardless of both flags
6. Each DDL operation tested individually (CREATE, ALTER, DROP, TRUNCATE, REINDEX, VACUUM, ANALYZE, CLUSTER)
