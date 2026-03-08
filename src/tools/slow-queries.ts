import { getDb } from "../db.js";
import { sql } from "kysely";
import { GetSlowQueriesInputSchema, validateInput } from "../validation.js";

export interface SlowQuery {
  query: string | null;
  calls: number;
  total_time_ms: number;
  mean_time_ms: number;
  min_time_ms: number;
  max_time_ms: number;
  stddev_time_ms: number;
  rows: number;
  shared_blks_hit: number;
  shared_blks_read: number;
  cache_hit_ratio: number;
  temp_blks_written: number;
}

export interface GetSlowQueriesOutput {
  queries?: SlowQuery[];
  stats_reset?: string | null;
  extension_installed: boolean;
  hint?: string;
  error?: string;
}

const PG13_SORT_COLUMN_MAP: Record<string, string> = {
  total_time: 'total_exec_time',
  mean_time: 'mean_exec_time',
  calls: 'calls',
  rows: 'rows'
};

const PG12_SORT_COLUMN_MAP: Record<string, string> = {
  total_time: 'total_time',
  mean_time: 'mean_time',
  calls: 'calls',
  rows: 'rows'
};

interface TimeColumns {
  total: string;
  mean: string;
  min: string;
  max: string;
  stddev: string;
}

const PG13_TIME_COLUMNS: TimeColumns = {
  total: 'total_exec_time',
  mean: 'mean_exec_time',
  min: 'min_exec_time',
  max: 'max_exec_time',
  stddev: 'stddev_exec_time'
};

const PG12_TIME_COLUMNS: TimeColumns = {
  total: 'total_time',
  mean: 'mean_time',
  min: 'min_time',
  max: 'max_time',
  stddev: 'stddev_time'
};

function buildStatementsQuery(
  sortBy: string,
  sortColumnMap: Record<string, string>,
  timeCols: TimeColumns,
  minCalls: number,
  minDurationMs: number,
  queryLimit: number
) {
  const sortColumn = sortColumnMap[sortBy];
  const selectAndFrom = `SELECT
  query,
  calls,
  ${timeCols.total} as total_time_ms,
  ${timeCols.mean} as mean_time_ms,
  ${timeCols.min} as min_time_ms,
  ${timeCols.max} as max_time_ms,
  ${timeCols.stddev} as stddev_time_ms,
  rows,
  shared_blks_hit,
  shared_blks_read,
  CASE WHEN (shared_blks_hit + shared_blks_read) = 0 THEN 100
    ELSE round(shared_blks_hit::numeric / (shared_blks_hit + shared_blks_read) * 100, 2)
  END as cache_hit_ratio,
  temp_blks_written
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  AND calls >= `;
  const midFilter = `
  AND ${timeCols.mean} >= `;
  const orderClause = `
ORDER BY ${sortColumn} DESC
LIMIT `;

  return sql<SlowQuery>`${sql.raw(selectAndFrom)}${minCalls}${sql.raw(midFilter)}${minDurationMs}${sql.raw(orderClause)}${queryLimit}`;
}

export async function getSlowQueriesTool(input: unknown): Promise<GetSlowQueriesOutput> {
  try {
    const validation = validateInput(GetSlowQueriesInputSchema, input);
    if (!validation.success) {
      return { extension_installed: false, error: `Input validation failed: ${validation.error}` };
    }

    const {
      sort_by = 'total_time',
      limit = 10,
      min_calls = 5,
      min_duration_ms = 0,
      include_query_text = true
    } = validation.data;

    const db = getDb();

    const extCheck = await sql<{ exists: number }>`
      SELECT 1 as exists FROM pg_extension WHERE extname = 'pg_stat_statements'
    `.execute(db);

    if (extCheck.rows.length === 0) {
      return {
        extension_installed: false,
        hint: "Enable pg_stat_statements for slow query analysis. Add shared_preload_libraries = 'pg_stat_statements' to postgresql.conf, restart PostgreSQL, then run CREATE EXTENSION pg_stat_statements;"
      };
    }

    let rows: SlowQuery[];
    try {
      const query = buildStatementsQuery(sort_by, PG13_SORT_COLUMN_MAP, PG13_TIME_COLUMNS, min_calls, min_duration_ms, limit);
      const result = await query.execute(db);
      rows = result.rows;
    } catch (err: any) {
      if (err?.message?.includes('column') && err?.message?.includes('does not exist')) {
        const query = buildStatementsQuery(sort_by, PG12_SORT_COLUMN_MAP, PG12_TIME_COLUMNS, min_calls, min_duration_ms, limit);
        const result = await query.execute(db);
        rows = result.rows;
      } else {
        throw err;
      }
    }

    if (!include_query_text) {
      rows = rows.map(r => ({ ...r, query: null }));
    }

    let statsReset: string | null = null;
    try {
      const resetResult = await sql<{ stats_reset: string }>`
        SELECT stats_reset::text FROM pg_stat_statements_info
      `.execute(db);
      statsReset = resetResult.rows[0]?.stats_reset ?? null;
    } catch {
      statsReset = null;
    }

    return {
      queries: rows,
      stats_reset: statsReset,
      extension_installed: true
    };
  } catch (error) {
    return {
      extension_installed: false,
      error: error instanceof Error ? error.message : "Unknown error occurred"
    };
  }
}
