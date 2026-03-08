import { getDb } from "../db.js";
import { sql } from "kysely";
import { SearchObjectsInputSchema, validateInput } from "../validation.js";

export interface SearchResult {
  object_type: string;
  schema_name: string;
  table_name: string | null;
  object_name: string;
  details: string | null;
}

export interface SearchObjectsOutput {
  results?: SearchResult[];
  total_matches?: number;
  truncated?: boolean;
  error?: string;
}

const ALL_OBJECT_TYPES = ['table', 'view', 'column', 'function', 'index', 'constraint'] as const;
const SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema', 'pg_toast'];

async function searchTables(db: any, likePattern: string, schemas: string[] | undefined): Promise<SearchResult[]> {
  const query = schemas
    ? sql<any>`
        SELECT 'table' as object_type, table_schema as schema_name, NULL as table_name, table_name as object_name, table_type as details
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND LOWER(table_name) LIKE LOWER(${likePattern})
          AND table_schema = ANY(${schemas})
      `
    : sql<any>`
        SELECT 'table' as object_type, table_schema as schema_name, NULL as table_name, table_name as object_name, table_type as details
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND LOWER(table_name) LIKE LOWER(${likePattern})
          AND table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      `;
  const result = await query.execute(db);
  return result.rows;
}

async function searchViews(db: any, likePattern: string, schemas: string[] | undefined): Promise<SearchResult[]> {
  const query = schemas
    ? sql<any>`
        SELECT 'view' as object_type, table_schema as schema_name, NULL as table_name, table_name as object_name, LEFT(view_definition, 100) as details
        FROM information_schema.views
        WHERE LOWER(table_name) LIKE LOWER(${likePattern})
          AND table_schema = ANY(${schemas})
      `
    : sql<any>`
        SELECT 'view' as object_type, table_schema as schema_name, NULL as table_name, table_name as object_name, LEFT(view_definition, 100) as details
        FROM information_schema.views
        WHERE LOWER(table_name) LIKE LOWER(${likePattern})
          AND table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      `;
  const result = await query.execute(db);
  return result.rows;
}

async function searchColumns(db: any, likePattern: string, schemas: string[] | undefined): Promise<SearchResult[]> {
  const query = schemas
    ? sql<any>`
        SELECT 'column' as object_type, table_schema as schema_name, table_name, column_name as object_name, data_type as details
        FROM information_schema.columns
        WHERE LOWER(column_name) LIKE LOWER(${likePattern})
          AND table_schema = ANY(${schemas})
      `
    : sql<any>`
        SELECT 'column' as object_type, table_schema as schema_name, table_name, column_name as object_name, data_type as details
        FROM information_schema.columns
        WHERE LOWER(column_name) LIKE LOWER(${likePattern})
          AND table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      `;
  const result = await query.execute(db);
  return result.rows;
}

async function searchFunctions(db: any, likePattern: string, schemas: string[] | undefined): Promise<SearchResult[]> {
  const query = schemas
    ? sql<any>`
        SELECT 'function' as object_type, n.nspname as schema_name, NULL as table_name, p.proname as object_name,
          pg_get_function_result(p.oid) || '(' || pg_get_function_arguments(p.oid) || ')' as details
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE LOWER(p.proname) LIKE LOWER(${likePattern})
          AND n.nspname = ANY(${schemas})
      `
    : sql<any>`
        SELECT 'function' as object_type, n.nspname as schema_name, NULL as table_name, p.proname as object_name,
          pg_get_function_result(p.oid) || '(' || pg_get_function_arguments(p.oid) || ')' as details
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE LOWER(p.proname) LIKE LOWER(${likePattern})
          AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      `;
  const result = await query.execute(db);
  return result.rows;
}

async function searchIndexes(db: any, likePattern: string, schemas: string[] | undefined): Promise<SearchResult[]> {
  const query = schemas
    ? sql<any>`
        SELECT 'index' as object_type, schemaname as schema_name, tablename as table_name, indexname as object_name, indexdef as details
        FROM pg_indexes
        WHERE LOWER(indexname) LIKE LOWER(${likePattern})
          AND schemaname = ANY(${schemas})
      `
    : sql<any>`
        SELECT 'index' as object_type, schemaname as schema_name, tablename as table_name, indexname as object_name, indexdef as details
        FROM pg_indexes
        WHERE LOWER(indexname) LIKE LOWER(${likePattern})
          AND schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      `;
  const result = await query.execute(db);
  return result.rows;
}

async function searchConstraints(db: any, likePattern: string, schemas: string[] | undefined): Promise<SearchResult[]> {
  const query = schemas
    ? sql<any>`
        SELECT 'constraint' as object_type, n.nspname as schema_name, cl.relname as table_name, c.conname as object_name, pg_get_constraintdef(c.oid) as details
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        JOIN pg_class cl ON cl.oid = c.conrelid
        WHERE LOWER(c.conname) LIKE LOWER(${likePattern})
          AND n.nspname = ANY(${schemas})
      `
    : sql<any>`
        SELECT 'constraint' as object_type, n.nspname as schema_name, cl.relname as table_name, c.conname as object_name, pg_get_constraintdef(c.oid) as details
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        JOIN pg_class cl ON cl.oid = c.conrelid
        WHERE LOWER(c.conname) LIKE LOWER(${likePattern})
          AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      `;
  const result = await query.execute(db);
  return result.rows;
}

const SEARCH_FNS: Record<string, (db: any, pattern: string, schemas: string[] | undefined) => Promise<SearchResult[]>> = {
  table: searchTables,
  view: searchViews,
  column: searchColumns,
  function: searchFunctions,
  index: searchIndexes,
  constraint: searchConstraints,
};

export async function searchObjectsTool(input: unknown): Promise<SearchObjectsOutput> {
  try {
    const validation = validateInput(SearchObjectsInputSchema, input);
    if (!validation.success) {
      return { error: `Input validation failed: ${validation.error}` };
    }

    const { pattern, object_types, schemas, limit: inputLimit } = validation.data;
    const types = object_types || [...ALL_OBJECT_TYPES];
    const limit = inputLimit ?? 20;
    const likePattern = `%${pattern}%`;
    const db = getDb();

    const allResults: SearchResult[] = [];

    for (const type of types) {
      const searchFn = SEARCH_FNS[type];
      if (searchFn) {
        const rows = await searchFn(db, likePattern, schemas);
        allResults.push(...rows);
      }
    }

    allResults.sort((a, b) => {
      const typeCmp = a.object_type.localeCompare(b.object_type);
      if (typeCmp !== 0) return typeCmp;
      return a.object_name.localeCompare(b.object_name);
    });

    const totalMatches = allResults.length;
    const truncated = totalMatches > limit;
    const results = allResults.slice(0, limit);

    return {
      results,
      total_matches: totalMatches,
      truncated,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
