import { type RawBuilder, sql } from "kysely";
import { getDb } from "../db.js";
import { ListIndexesInputSchema, validateInput } from "../validation.js";

export interface IndexInfo {
  schema_name: string;
  table_name: string;
  index_name: string;
  index_type: string;
  is_unique: boolean;
  is_primary: boolean;
  columns: string;
  definition: string;
  size_bytes?: number;
}

export interface ListIndexesOutput {
  indexes?: IndexInfo[];
  error?: string;
}

export async function listIndexesTool(input: unknown): Promise<ListIndexesOutput> {
  try {
    // Validate input
    const validation = validateInput(ListIndexesInputSchema, input);
    if (!validation.success) {
      return { error: `Input validation failed: ${validation.error}` };
    }

    const validatedInput = validation.data;
    const db = getDb();

    let query: RawBuilder<IndexInfo>;
    if (validatedInput.table) {
      query = sql<IndexInfo>`
        SELECT 
          schemaname as schema_name,
          tablename as table_name,
          indexname as index_name,
          CASE 
            WHEN indexdef LIKE '%USING btree%' THEN 'btree'
            WHEN indexdef LIKE '%USING hash%' THEN 'hash'
            WHEN indexdef LIKE '%USING gin%' THEN 'gin'
            WHEN indexdef LIKE '%USING gist%' THEN 'gist'
            WHEN indexdef LIKE '%USING spgist%' THEN 'sp-gist'
            WHEN indexdef LIKE '%USING brin%' THEN 'brin'
            ELSE 'unknown'
          END as index_type,
          CASE WHEN indexdef LIKE '%UNIQUE%' THEN true ELSE false END as is_unique,
          CASE WHEN indexname LIKE '%_pkey' THEN true ELSE false END as is_primary,
          regexp_replace(
            regexp_replace(indexdef, '.*\\((.*?)\\).*', '\\1'),
            ' COLLATE [^,)]+', '', 'g'
          ) as columns,
          indexdef as definition,
          pg_relation_size(schemaname||'.'||indexname) as size_bytes
        FROM pg_indexes 
        WHERE schemaname = ${validatedInput.schema}
          AND tablename = ${validatedInput.table}
        ORDER BY tablename, indexname
      `;
    } else {
      query = sql<IndexInfo>`
        SELECT 
          schemaname as schema_name,
          tablename as table_name,
          indexname as index_name,
          CASE 
            WHEN indexdef LIKE '%USING btree%' THEN 'btree'
            WHEN indexdef LIKE '%USING hash%' THEN 'hash'
            WHEN indexdef LIKE '%USING gin%' THEN 'gin'
            WHEN indexdef LIKE '%USING gist%' THEN 'gist'
            WHEN indexdef LIKE '%USING spgist%' THEN 'sp-gist'
            WHEN indexdef LIKE '%USING brin%' THEN 'brin'
            ELSE 'unknown'
          END as index_type,
          CASE WHEN indexdef LIKE '%UNIQUE%' THEN true ELSE false END as is_unique,
          CASE WHEN indexname LIKE '%_pkey' THEN true ELSE false END as is_primary,
          regexp_replace(
            regexp_replace(indexdef, '.*\\((.*?)\\).*', '\\1'),
            ' COLLATE [^,)]+', '', 'g'
          ) as columns,
          indexdef as definition,
          pg_relation_size(schemaname||'.'||indexname) as size_bytes
        FROM pg_indexes 
        WHERE schemaname = ${validatedInput.schema}
        ORDER BY tablename, indexname
      `;
    }

    const result = await query.execute(db);

    return {
      indexes: result.rows,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
