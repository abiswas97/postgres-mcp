import { sql } from "kysely";
import { getDb } from "../db.js";
import { DiagnoseDatabaseInputSchema, validateInput } from "../validation.js";

const CACHE_HIT_WARNING = 99;
const CACHE_HIT_CRITICAL = 95;
const CONNECTION_WARNING_PCT = 70;
const CONNECTION_CRITICAL_PCT = 90;
const LONG_QUERY_WARNING_SECS = 60;
const LONG_QUERY_CRITICAL_SECS = 300;
const DEAD_TUPLE_WARNING = 10000;
const DEAD_TUPLE_PCT_WARNING = 10;
const SEQUENCE_WARNING_PCT = 75;
const SEQUENCE_CRITICAL_PCT = 90;

type CheckStatus = "healthy" | "warning" | "critical";

interface CheckResult {
  status: CheckStatus;
  // biome-ignore lint/suspicious/noExplicitAny: CheckResult carries heterogeneous diagnostic fields
  [key: string]: any;
}

export interface DiagnoseDatabaseOutput {
  status?: CheckStatus;
  summary?: string;
  checks?: Record<string, CheckResult>;
  checks_skipped?: string[];
  error?: string;
  timestamp?: string;
}

function worstStatus(a: CheckStatus, b: CheckStatus): CheckStatus {
  const rank: Record<CheckStatus, number> = { healthy: 0, warning: 1, critical: 2 };
  return rank[a] >= rank[b] ? a : b;
}

async function checkCacheHitRatio(): Promise<CheckResult> {
  const db = getDb();
  const result = await sql<{ ratio: number }>`
    SELECT
      CASE WHEN (sum(blks_hit) + sum(blks_read)) = 0 THEN 100
      ELSE round(sum(blks_hit)::numeric / (sum(blks_hit) + sum(blks_read)) * 100, 2)
      END as ratio
    FROM pg_stat_database
    WHERE datname = current_database()
  `.execute(db);

  const ratio = Number(result.rows[0]?.ratio ?? 100);
  let status: CheckStatus = "healthy";
  if (ratio < CACHE_HIT_CRITICAL) status = "critical";
  else if (ratio < CACHE_HIT_WARNING) status = "warning";

  return { status, value: ratio, threshold: CACHE_HIT_WARNING };
}

async function checkConnectionSaturation(): Promise<CheckResult> {
  const db = getDb();
  const maxResult = await sql<{ max_connections: number }>`
    SELECT setting::int as max_connections FROM pg_settings WHERE name = 'max_connections'
  `.execute(db);

  const maxConnections = maxResult.rows[0]?.max_connections ?? 100;

  const connResult = await sql<{
    total: number;
    active: number;
    idle: number;
    idle_in_transaction: number;
  }>`
    SELECT
      count(*) as total,
      count(*) FILTER (WHERE state = 'active') as active,
      count(*) FILTER (WHERE state = 'idle') as idle,
      count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction
    FROM pg_stat_activity WHERE datname IS NOT NULL
  `.execute(db);

  const row = connResult.rows[0] ?? { total: 0, active: 0, idle: 0, idle_in_transaction: 0 };
  const total = Number(row.total);
  const active = Number(row.active);
  const idle = Number(row.idle);
  const idleInTx = Number(row.idle_in_transaction);
  const utilizationPct = Math.round((total / maxConnections) * 100);

  let status: CheckStatus = "healthy";
  if (utilizationPct > CONNECTION_CRITICAL_PCT) status = "critical";
  else if (utilizationPct > CONNECTION_WARNING_PCT) status = "warning";

  return {
    status,
    active,
    idle,
    idle_in_transaction: idleInTx,
    total,
    max: maxConnections,
    utilization_pct: utilizationPct,
  };
}

async function checkLongRunningQueries(): Promise<CheckResult> {
  const db = getDb();
  const result = await sql<{
    pid: number;
    duration_seconds: number;
    state: string;
    query_preview: string;
  }>`
    SELECT pid,
      EXTRACT(EPOCH FROM (now() - query_start))::int as duration_seconds,
      state, LEFT(query, 200) as query_preview
    FROM pg_stat_activity
    WHERE state = 'active'
      AND query_start < now() - interval '30 seconds'
      AND datname IS NOT NULL
    ORDER BY duration_seconds DESC
    LIMIT 10
  `.execute(db);

  const queries = result.rows;
  let status: CheckStatus = "healthy";

  for (const q of queries) {
    if (q.duration_seconds > LONG_QUERY_CRITICAL_SECS) {
      status = "critical";
      break;
    }
    if (q.duration_seconds > LONG_QUERY_WARNING_SECS) {
      status = "warning";
    }
  }

  return { status, count: queries.length, queries };
}

async function checkBlockingLocks(): Promise<CheckResult> {
  const db = getDb();
  // biome-ignore lint/suspicious/noExplicitAny: lock chain rows are heterogeneous pg_locks join result
  const result = await sql<any>`
    SELECT
      blocked.pid as blocked_pid,
      blocked_activity.usename as blocked_user,
      LEFT(blocked_activity.query, 200) as blocked_query,
      blocking.pid as blocking_pid,
      blocking_activity.usename as blocking_user,
      LEFT(blocking_activity.query, 200) as blocking_query
    FROM pg_locks blocked
    JOIN pg_locks blocking ON blocking.locktype = blocked.locktype
      AND blocking.database IS NOT DISTINCT FROM blocked.database
      AND blocking.relation IS NOT DISTINCT FROM blocked.relation
      AND blocking.page IS NOT DISTINCT FROM blocked.page
      AND blocking.tuple IS NOT DISTINCT FROM blocked.tuple
      AND blocking.transactionid IS NOT DISTINCT FROM blocked.transactionid
      AND blocking.classid IS NOT DISTINCT FROM blocked.classid
      AND blocking.objid IS NOT DISTINCT FROM blocked.objid
      AND blocking.objsubid IS NOT DISTINCT FROM blocked.objsubid
      AND blocking.pid != blocked.pid
    JOIN pg_stat_activity blocked_activity ON blocked_activity.pid = blocked.pid
    JOIN pg_stat_activity blocking_activity ON blocking_activity.pid = blocking.pid
    WHERE NOT blocked.granted
    LIMIT 20
  `.execute(db);

  const chains = result.rows;
  const status: CheckStatus = chains.length > 0 ? "warning" : "healthy";
  return { status, chains };
}

async function checkVacuumHealth(): Promise<CheckResult> {
  const db = getDb();
  // biome-ignore lint/suspicious/noExplicitAny: pg_stat_user_tables vacuum fields are dynamic
  const result = await sql<any>`
    SELECT schemaname, relname as table_name,
      n_dead_tup, n_live_tup,
      last_vacuum::text, last_autovacuum::text
    FROM pg_stat_user_tables
    WHERE n_dead_tup > ${DEAD_TUPLE_WARNING}
      AND (n_live_tup = 0 OR (n_dead_tup::float / GREATEST(n_live_tup, 1) * 100) > ${DEAD_TUPLE_PCT_WARNING})
    ORDER BY n_dead_tup DESC
    LIMIT 20
  `.execute(db);

  const tables = result.rows;
  const status: CheckStatus = tables.length > 0 ? "warning" : "healthy";
  return { status, tables_needing_vacuum: tables };
}

async function checkUnusedIndexes(): Promise<CheckResult> {
  const db = getDb();
  // biome-ignore lint/suspicious/noExplicitAny: pg_stat_user_indexes unused index fields are dynamic
  const result = await sql<any>`
    SELECT schemaname, relname as table_name,
      indexrelname as index_name,
      pg_size_pretty(pg_relation_size(indexrelid)) as size_pretty
    FROM pg_stat_user_indexes
    WHERE idx_scan = 0
      AND indexrelname NOT LIKE '%pkey%'
      AND schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY pg_relation_size(indexrelid) DESC
    LIMIT 20
  `.execute(db);

  const indexes = result.rows;
  const status: CheckStatus = indexes.length > 0 ? "warning" : "healthy";
  return { status, indexes };
}

async function checkDuplicateIndexes(): Promise<CheckResult> {
  const db = getDb();
  // biome-ignore lint/suspicious/noExplicitAny: duplicate index join result has dynamic pg_catalog fields
  const result = await sql<any>`
    SELECT
      n.nspname as schema_name,
      ci.relname as table_name,
      array_agg(i2.relname ORDER BY i2.relname) as index_names,
      pg_get_indexdef(ix.indexrelid) as definition
    FROM pg_index ix
    JOIN pg_class ci ON ci.oid = ix.indrelid
    JOIN pg_class i2 ON i2.oid = ix.indexrelid
    JOIN pg_namespace n ON n.oid = ci.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    GROUP BY n.nspname, ci.relname, ix.indkey, pg_get_indexdef(ix.indexrelid)
    HAVING count(*) > 1
  `.execute(db);

  const duplicates = result.rows;
  const status: CheckStatus = duplicates.length > 0 ? "warning" : "healthy";
  return { status, duplicates };
}

async function checkSequenceHealth(): Promise<CheckResult> {
  const db = getDb();
  // biome-ignore lint/suspicious/noExplicitAny: pg_sequences fields include dynamic numeric values
  const result = await sql<any>`
    SELECT schemaname, sequencename as name,
      last_value, max_value,
      round((last_value::numeric / max_value * 100), 2) as pct_used
    FROM pg_sequences
    WHERE last_value IS NOT NULL
      AND max_value > 0
      AND (last_value::numeric / max_value * 100) > ${SEQUENCE_WARNING_PCT}
    ORDER BY pct_used DESC
  `.execute(db);

  const sequences = result.rows;
  let status: CheckStatus = "healthy";

  if (sequences.length > 0) {
    status = "warning";
    for (const seq of sequences) {
      if (Number(seq.pct_used) > SEQUENCE_CRITICAL_PCT) {
        status = "critical";
        break;
      }
    }
  }

  return { status, sequences_near_limit: sequences };
}

async function checkDatabaseSize(): Promise<CheckResult> {
  const db = getDb();
  const result = await sql<{ size_bytes: number; size_pretty: string }>`
    SELECT pg_database_size(current_database()) as size_bytes,
      pg_size_pretty(pg_database_size(current_database())) as size_pretty
  `.execute(db);

  const row = result.rows[0] ?? { size_bytes: 0, size_pretty: "0 bytes" };
  return { status: "healthy", size_bytes: Number(row.size_bytes), size_pretty: row.size_pretty };
}

export async function diagnoseDatabaseTool(input: unknown): Promise<DiagnoseDatabaseOutput> {
  try {
    const validation = validateInput(DiagnoseDatabaseInputSchema, input);
    if (!validation.success) {
      return { error: `Input validation failed: ${validation.error}` };
    }

    const { include_queries, include_connections } = validation.data;
    const checks: Record<string, CheckResult> = {};
    const checksSkipped: string[] = [];
    let overallStatus: CheckStatus = "healthy";

    const checkEntries: Array<{
      name: string;
      fn: () => Promise<CheckResult>;
      condition?: boolean;
    }> = [
      { name: "cache_hit_ratio", fn: checkCacheHitRatio },
      {
        name: "connection_saturation",
        fn: checkConnectionSaturation,
        condition: include_connections !== false,
      },
      {
        name: "long_running_queries",
        fn: checkLongRunningQueries,
        condition: include_queries !== false,
      },
      { name: "blocking_locks", fn: checkBlockingLocks },
      { name: "vacuum_health", fn: checkVacuumHealth },
      { name: "unused_indexes", fn: checkUnusedIndexes },
      { name: "duplicate_indexes", fn: checkDuplicateIndexes },
      { name: "sequence_health", fn: checkSequenceHealth },
      { name: "database_size", fn: checkDatabaseSize },
    ];

    for (const entry of checkEntries) {
      if (entry.condition === false) continue;
      try {
        const result = await entry.fn();
        checks[entry.name] = result;
        overallStatus = worstStatus(overallStatus, result.status);
      } catch (err) {
        checksSkipped.push(
          `${entry.name}: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    }

    const issues: string[] = [];
    for (const [name, check] of Object.entries(checks)) {
      if (check.status === "healthy") continue;
      if (name === "cache_hit_ratio") {
        issues.push(`low cache hit ratio (${check.value}%)`);
      } else if (name === "connection_saturation") {
        issues.push(`connection utilization at ${check.utilization_pct}%`);
      } else if (name === "long_running_queries") {
        issues.push(`${check.count} long-running queries`);
      } else if (name === "blocking_locks") {
        issues.push(`${check.chains.length} blocking lock chains`);
      } else if (name === "vacuum_health") {
        issues.push(`${check.tables_needing_vacuum.length} tables need vacuum`);
      } else if (name === "unused_indexes") {
        issues.push(`${check.indexes.length} unused indexes`);
      } else if (name === "duplicate_indexes") {
        issues.push(`${check.duplicates.length} duplicate indexes`);
      } else if (name === "sequence_health") {
        issues.push(`${check.sequences_near_limit.length} sequences near limit`);
      }
    }

    const warningCount = Object.values(checks).filter((c) => c.status === "warning").length;
    const criticalCount = Object.values(checks).filter((c) => c.status === "critical").length;

    let summary: string;
    if (overallStatus === "healthy") {
      summary = "healthy: all checks passed";
    } else {
      const parts: string[] = [];
      if (criticalCount > 0) parts.push(`${criticalCount} critical`);
      if (warningCount > 0) parts.push(`${warningCount} warning${warningCount > 1 ? "s" : ""}`);
      summary = `${parts.join(", ")}: ${issues.join(", ")}`;
    }

    return {
      status: overallStatus,
      summary,
      checks,
      checks_skipped: checksSkipped.length > 0 ? checksSkipped : undefined,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
