# Phase 1: Diagnostic Tools + Plugin Conversion

**Date:** 2026-03-08
**Version:** 2.0.0 (breaking: tool consolidation)

## Problem

The server covers schema inspection and query execution but lacks operational diagnostics — health checks, slow query analysis, connection monitoring. Every serious competitor (crystaldba 2.3k stars, PostgreSQL-Ops 30+ tools, Neon) offers these. We don't.

Additionally, there is no generic PostgreSQL plugin in the official Claude Code plugin marketplace. Supabase and Firebase are the only database plugins, both platform-locked.

## Goals

1. Add 4 composite diagnostic tools (health, slow queries, connections, object search)
2. Consolidate existing tools from 10 to 6 (eliminate duplicate schemas, reduce token footprint)
3. Convert the project into a Claude Code plugin with model-invoked skills
4. Maintain standalone MCP server compatibility (npx usage unchanged)
5. Keep total tool count at 10, token footprint under 1,100

## Non-Goals

- Slash commands (skills auto-invoke on intent)
- Config file support (env vars are sufficient for Phase 1)
- pg_stat_statements auto-installation
- Write-mode diagnostics (all new tools are read-only)

## Competitive Landscape

| Server | Stars | Our Advantage |
|---|---|---|
| crystaldba/postgres-mcp | 2.3k | Python/Docker, no plugin version, no pagination |
| timescale/pg-aiguide | 1.6k | Docs-only, no live DB access |
| call518/PostgreSQL-Ops | - | 30+ tools (context bloat), read-only only |
| Official @mcp/server-postgres | archived | Deprecated, had SQL injection vuln |

Our differentiators: pagination system, plugin distribution, token-efficient composite tools, Node.js/npm native, Aurora/RDS SSL support, configurable read/write mode.

---

## Architecture

### Project Structure

```
postgres-mcp-server/
├── .claude-plugin/plugin.json
├── .mcp.json
├── skills/
│   ├── database-health/SKILL.md
│   ├── slow-query-analysis/SKILL.md
│   └── connection-debug/SKILL.md
├── src/
│   ├── index.ts
│   ├── db.ts
│   ├── validation.ts
│   └── tools/
│       ├── query.ts
│       ├── describe.ts          # absorbs constraints + stats
│       ├── list.ts              # list_objects (replaces 3 tools)
│       ├── schemas.ts
│       ├── indexes.ts
│       ├── performance.ts       # explain_query only
│       ├── search.ts            # NEW
│       ├── diagnostics.ts       # NEW
│       ├── slow-queries.ts      # NEW
│       └── connections.ts       # NEW
├── tests/
├── package.json
└── README.md
```

### Dual Distribution

- **Plugin users:** `claude plugin install postgres-mcp-server` → auto-configures MCP server + gets skills
- **Standalone users:** `npx postgres-mcp-server` → MCP server only, works in any MCP client

---

## Tool Consolidation

### Before (10 tools, ~895 tokens)

| Tool | Schema Tokens |
|---|---|
| query | ~206 |
| describe_table | ~92 |
| list_tables | ~54 |
| get_constraints | ~90 |
| list_schemas | ~41 |
| list_indexes | ~91 |
| explain_query | ~121 |
| get_table_stats | ~93 |
| list_views | ~53 |
| list_functions | ~54 |

### After (6 tools, ~550 tokens)

| Tool | Change | Tokens |
|---|---|---|
| query | Trim `.describe()` strings, shorten description | ~170 |
| describe_table | Absorb get_constraints + get_table_stats. Always return columns + constraints + size/vacuum stats | ~110 |
| list_objects | Replace list_tables + list_views + list_functions. Add `type: "tables" \| "views" \| "functions"` param | ~70 |
| list_schemas | Unchanged | ~41 |
| list_indexes | Unchanged | ~91 |
| explain_query | Unchanged | ~121 |

### Token Optimizations

1. Remove `.describe()` from QueryInputSchema properties where name is self-explanatory (parameters, pageSize, offset)
2. Shorten query tool description: "Execute SQL with pagination and parameterization" → drop redundant details already in schema
3. Eliminate 4 duplicate tool registrations through merges

---

## New Tools

### Tool 7: `search_objects`

Find tables, columns, functions, views, indexes, constraints by name pattern across schemas.

```typescript
// Input
{
  pattern: string              // Case-insensitive, supports SQL LIKE % wildcards
  object_types?: ("table" | "view" | "column" | "function" | "index" | "constraint")[]
  schemas?: string[]           // Default: all non-system schemas
  limit?: number               // 1-100, default 20
}

// Output
{
  results: [{
    object_type: string,
    schema: string,
    table_name?: string,       // For columns, indexes, constraints
    object_name: string,
    details: string            // One-line: column type, function signature, index def
  }],
  total_matches: number,
  truncated: boolean
}
```

**Sources queried:** information_schema.tables, information_schema.columns, information_schema.routines, pg_indexes, information_schema.table_constraints.

### Tool 8: `diagnose_database`

Single-call composite health assessment.

```typescript
// Input
{
  include_queries?: boolean      // Include slow query preview. Default: true
  include_connections?: boolean  // Include connection details. Default: true
}

// Output
{
  status: "healthy" | "warning" | "critical",
  summary: string,               // "3 warnings: high dead tuples on users, 2 unused indexes"
  checks: {
    cache_hit_ratio: {
      status: "healthy" | "warning" | "critical",
      value: number,             // e.g., 99.2
      threshold: number,         // e.g., 99.0
      detail?: string
    },
    connections: {
      status, active, idle, idle_in_transaction, total, max, detail?
    },
    long_running_queries: {
      status, count, queries?: [{ pid, duration_seconds, query_preview, state }]
    },
    blocking_locks: {
      status, chains?: [{ blocked_pid, blocking_pid, blocked_query, blocking_query }]
    },
    vacuum_health: {
      status, tables_needing_vacuum?: [{ schema, table, dead_tuples, last_vacuum }]
    },
    unused_indexes: {
      status, indexes?: [{ schema, table, index_name, size_pretty }]
    },
    duplicate_indexes: {
      status, duplicates?: [{ schema, table, indexes: string[], columns }]
    },
    sequence_health: {
      status, sequences_near_limit?: [{ schema, name, current, max, pct_used }]
    },
    database_size: {
      size_bytes, size_pretty
    }
  },
  checks_skipped: string[],     // Checks that couldn't run + reason
  timestamp: string
}
```

**Thresholds:**
- Cache hit ratio: warning < 99%, critical < 95%
- Connection utilization: warning > 70%, critical > 90%
- Long-running queries: warning if any > 60s, critical if any > 300s
- Dead tuples: warning if > 10,000 dead tuples and dead > 10% of live
- Sequence usage: warning > 75%, critical > 90%

**Response compactness:** Only expand detail for non-healthy checks. Healthy checks return status + value only.

### Tool 9: `get_slow_queries`

Deep dive into query performance via pg_stat_statements.

```typescript
// Input
{
  sort_by?: "total_time" | "mean_time" | "calls" | "rows"  // Default: "total_time"
  limit?: number               // 1-50, default 10
  min_calls?: number           // Default: 5
  min_duration_ms?: number     // Default: 0
  include_query_text?: boolean // Default: true
}

// Output
{
  queries?: [{
    query: string,
    calls: number,
    total_time_ms: number,
    mean_time_ms: number,
    min_time_ms: number,
    max_time_ms: number,
    stddev_time_ms: number,
    rows: number,
    shared_blks_hit: number,
    shared_blks_read: number,
    cache_hit_ratio: number,
    temp_blks_written: number
  }],
  stats_reset?: string,
  extension_installed: boolean,
  hint?: string                // Setup instructions if extension missing
}
```

**Graceful degradation:** When pg_stat_statements is unavailable, returns `{ extension_installed: false, hint: "Enable pg_stat_statements for slow query analysis. Add shared_preload_libraries = 'pg_stat_statements' to postgresql.conf and run CREATE EXTENSION pg_stat_statements;" }`.

### Tool 10: `get_connections`

Active connection monitoring and lock detection.

```typescript
// Input
{
  include_queries?: boolean    // Include query text for active connections. Default: false
  group_by?: "state" | "user" | "application" | "client"  // Default: "state"
}

// Output
{
  summary: {
    total: number,
    max_connections: number,
    utilization_pct: number,
    by_state: { active, idle, idle_in_transaction, waiting, disabled }
  },
  connections: [{
    pid: number,
    user: string,
    database: string,
    application_name: string,
    client_addr: string,
    state: string,
    state_changed_at: string,
    duration_seconds: number,
    wait_event_type?: string,
    wait_event?: string,
    query?: string
  }],
  warnings: string[],
  timestamp: string
}
```

**Warnings auto-generated for:** connections idle-in-transaction > 5 minutes, utilization > 70%, any waiting connections.

---

## pg_stat_statements Strategy

- **Detection:** Per-call check via `SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'`. No caching. Trivial query cost, avoids stale state.
- **When unavailable:** Tools return structured response with `extension_installed: false` and setup hint. `diagnose_database` skips slow query section and lists it in `checks_skipped`.
- **Documentation:** README includes setup guide for RDS, Aurora, vanilla PostgreSQL.
- **Recommendation level:** Recommended, not required. All other checks work without it.

---

## Plugin Components

### plugin.json

```json
{
  "name": "postgres-mcp-server",
  "version": "2.0.0",
  "description": "PostgreSQL database access with diagnostics, health checks, and query analysis",
  "components": {
    "skills": ["skills/*/SKILL.md"],
    "mcp": [".mcp.json"]
  }
}
```

### .mcp.json

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["postgres-mcp-server@latest"],
      "env": {
        "DB_HOST": "${DB_HOST:-127.0.0.1}",
        "DB_PORT": "${DB_PORT:-5432}",
        "DB_USER": "${DB_USER:-postgres}",
        "DB_NAME": "${DB_NAME:-postgres}",
        "DB_PASSWORD": "${DB_PASSWORD}",
        "DB_SSL": "${DB_SSL:-true}",
        "READ_ONLY": "${READ_ONLY:-true}"
      }
    }
  }
}
```

### Skill: database-health

```markdown
---
name: database-health
description: Diagnose database health issues including cache performance, connection saturation, vacuum status, and unused indexes. Use when investigating database problems or running routine health checks.
---

Run diagnose_database to get a composite health assessment.

Interpret results:
- critical status: Highlight the critical checks first, suggest immediate actions
- warning status: List warnings by severity, suggest maintenance actions
- healthy status: Confirm health, note any checks_skipped

If slow queries appear in results, offer to run get_slow_queries for deeper analysis.
If connection issues appear, offer to run get_connections for per-connection detail.
```

### Skill: slow-query-analysis

```markdown
---
name: slow-query-analysis
description: Analyze slow queries and suggest optimizations. Use when investigating query performance, high CPU usage, or slow response times.
---

Workflow:
1. Run get_slow_queries sorted by total_time
2. For the top offender, run explain_query with analyze=true
3. Look for sequential scans on large tables, sort spills, bad row estimates
4. Check list_indexes on affected tables
5. Suggest: missing indexes, query rewrites, or configuration changes

If pg_stat_statements is not installed, guide the user through setup.
```

### Skill: connection-debug

```markdown
---
name: connection-debug
description: Debug database connection issues including too many connections, idle transactions, lock contention, and connection pool exhaustion. Use when the database is unresponsive or connections are refused.
---

Workflow:
1. Run get_connections with include_queries=true
2. Check warnings for idle-in-transaction connections (suggest terminating if > 10 min)
3. If utilization > 80%, identify top consumers by application_name or user
4. If locks detected, run diagnose_database to see blocking chains
5. Suggest: connection pool tuning, idle timeout configuration, or application fixes
```

---

## Token Budget Summary

| Component | Tokens | Notes |
|---|---|---|
| 6 consolidated existing tools | ~550 | Down from ~895 (38% reduction) |
| 4 new diagnostic tools | ~500 | Composite but lean schemas |
| **MCP total** | **~1,050** | Under 10K deferral threshold |
| 3 skill descriptions | ~100 | Always loaded |
| Skill content | 0 idle | Loaded on-demand only |

---

## Breaking Changes (→ 2.0.0)

| Removed Tool | Replacement |
|---|---|
| `list_tables` | `list_objects({ type: "tables" })` |
| `list_views` | `list_objects({ type: "views" })` |
| `list_functions` | `list_objects({ type: "functions" })` |
| `get_constraints` | `describe_table` (constraints always included) |
| `get_table_stats` | `describe_table` (stats always included) |

MCP clients don't have strong coupling to tool names (the LLM discovers tools dynamically), so the migration impact is low. Document in CHANGELOG and README.

---

## Testing Strategy

### Unit Tests
- Mock pg_catalog responses for each new tool
- Test diagnose_database aggregation logic (healthy/warning/critical thresholds)
- Test graceful degradation: pg_stat_statements missing, insufficient privileges
- Test search_objects across multiple object types
- Test list_objects with each type value
- Test describe_table returns columns + constraints + stats

### Container Tests (testcontainers)
- PostgreSQL with pg_stat_statements enabled via shared_preload_libraries
- Seed schema: users, posts, categories, tags (existing) + add sequences, views, functions
- Generate slow queries for pg_stat_statements to capture
- Create idle-in-transaction connections for get_connections testing
- Create blocking locks for diagnose_database lock detection

### Edge Cases
- Empty database (no tables, no stats)
- pg_stat_statements not installed
- Non-superuser permissions
- Zero active connections (only the test connection)
- Tables with no indexes, no constraints
- Sequences at various fill levels

---

## Implementation Order

1. **Tool consolidation** — merge existing tools, update tests, verify nothing breaks
2. **search_objects** — simplest new tool, no extension dependencies
3. **get_connections** — straightforward pg_stat_activity queries
4. **diagnose_database** — most complex, aggregates many checks
5. **get_slow_queries** — requires pg_stat_statements handling
6. **Plugin scaffolding** — plugin.json, .mcp.json, skills
7. **Documentation** — README update, CHANGELOG, migration guide

---

## Success Criteria

- [ ] All 10 tools work on vanilla PostgreSQL 12+ without extensions
- [ ] diagnose_database returns actionable health status in < 2 seconds
- [ ] get_slow_queries gracefully handles missing pg_stat_statements
- [ ] search_objects finds objects across schemas in a single call
- [ ] Total tool count: 10 (6 consolidated + 4 new)
- [ ] Estimated token footprint: ~1,050 (under 10K threshold)
- [ ] All existing tests pass (updated for consolidated tool names)
- [ ] New container tests cover each tool with realistic data
- [ ] Plugin installable via claude plugin install
- [ ] Standalone npx usage unchanged
