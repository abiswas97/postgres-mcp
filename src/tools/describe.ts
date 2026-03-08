import { sql } from "kysely";
import { getDb } from "../db.js";

export interface DescribeTableInput {
  schema: string;
  table: string;
}

export interface ColumnInfo {
  column_name: string;
  data_type: string;
  character_maximum_length: number | null;
  is_nullable: string;
  column_default: string | null;
}

export interface ConstraintInfo {
  constraint_name: string;
  constraint_type: string;
  constraint_definition: string;
}

export interface TableStatsInfo {
  schema_name: string;
  table_name: string;
  row_count: number;
  table_size_bytes: number;
  table_size_pretty: string;
  index_size_bytes: number;
  index_size_pretty: string;
  total_size_bytes: number;
  total_size_pretty: string;
  last_vacuum?: string;
  last_autovacuum?: string;
  last_analyze?: string;
  last_autoanalyze?: string;
}

export interface DescribeTableOutput {
  columns?: ColumnInfo[];
  constraints?: ConstraintInfo[];
  stats?: TableStatsInfo | null;
  error?: string;
}

export async function describeTableTool(input: DescribeTableInput): Promise<DescribeTableOutput> {
  try {
    const db = getDb();

    const columnsQuery = sql<ColumnInfo>`
      SELECT
        column_name,
        data_type,
        character_maximum_length,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = ${input.schema}
        AND table_name = ${input.table}
      ORDER BY ordinal_position
    `.execute(db);

    const constraintsQuery = sql<ConstraintInfo>`
      SELECT
        c.conname as constraint_name,
        CASE c.contype
          WHEN 'p' THEN 'PRIMARY KEY'
          WHEN 'f' THEN 'FOREIGN KEY'
          WHEN 'u' THEN 'UNIQUE'
          WHEN 'c' THEN 'CHECK'
          ELSE c.contype
        END as constraint_type,
        pg_get_constraintdef(c.oid) as constraint_definition
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      JOIN pg_class cl ON cl.oid = c.conrelid
      WHERE n.nspname = ${input.schema}
        AND cl.relname = ${input.table}
      ORDER BY c.conname
    `.execute(db);

    const statsQuery = sql<TableStatsInfo>`
      SELECT
        schemaname as schema_name,
        relname as table_name,
        (COALESCE(n_tup_ins, 0) + COALESCE(n_tup_upd, 0) + COALESCE(n_tup_del, 0))::bigint as row_count,
        pg_relation_size(schemaname||'.'||relname) as table_size_bytes,
        pg_size_pretty(pg_relation_size(schemaname||'.'||relname)) as table_size_pretty,
        pg_indexes_size(schemaname||'.'||relname) as index_size_bytes,
        pg_size_pretty(pg_indexes_size(schemaname||'.'||relname)) as index_size_pretty,
        pg_total_relation_size(schemaname||'.'||relname) as total_size_bytes,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||relname)) as total_size_pretty,
        last_vacuum::text,
        last_autovacuum::text,
        last_analyze::text,
        last_autoanalyze::text
      FROM pg_stat_user_tables
      WHERE schemaname = ${input.schema}
        AND relname = ${input.table}
    `
      .execute(db)
      .then((result) => {
        if (result.rows.length === 0) return null;
        const row = result.rows[0];
        return {
          ...row,
          row_count: Number(row.row_count),
          table_size_bytes: Number(row.table_size_bytes),
          index_size_bytes: Number(row.index_size_bytes),
          total_size_bytes: Number(row.total_size_bytes),
        };
      })
      .catch(() => null);

    const [columnsResult, constraintsResult, statsResult] = await Promise.all([
      columnsQuery,
      constraintsQuery,
      statsQuery,
    ]);

    return {
      columns: columnsResult.rows,
      constraints: constraintsResult.rows,
      stats: statsResult,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
