import { type Kysely, sql } from "kysely";
import { type Database, getDb } from "../db.js";
import { ListObjectsInputSchema, validateInput } from "../validation.js";

export interface ObjectInfo {
  object_name: string;
  object_type: string;
  schema_name: string;
  details?: string | null;
}

export interface ListObjectsOutput {
  objects?: ObjectInfo[];
  error?: string;
}

async function listTables(db: Kysely<Database>, schema: string): Promise<ObjectInfo[]> {
  const query = sql<{ table_name: string; table_type: string; table_schema: string }>`
    SELECT
      table_name,
      table_type,
      table_schema
    FROM information_schema.tables
    WHERE table_schema = ${schema}
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;

  const result = await query.execute(db);

  return result.rows.map((row) => ({
    object_name: row.table_name,
    object_type: "BASE TABLE",
    schema_name: row.table_schema,
    details: null,
  }));
}

async function listViews(db: Kysely<Database>, schema: string): Promise<ObjectInfo[]> {
  const query = sql<{ table_schema: string; table_name: string; view_definition: string }>`
    SELECT
      table_schema,
      table_name,
      view_definition
    FROM information_schema.views
    WHERE table_schema = ${schema}
    ORDER BY table_name
  `;

  const result = await query.execute(db);

  return result.rows.map((row) => ({
    object_name: row.table_name,
    object_type: "VIEW",
    schema_name: row.table_schema,
    details: row.view_definition,
  }));
}

async function listFunctions(db: Kysely<Database>, schema: string): Promise<ObjectInfo[]> {
  const query = sql<{
    schema_name: string;
    function_name: string;
    return_type: string;
    argument_types: string;
    function_type: string;
  }>`
    SELECT
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_result(p.oid) as return_type,
      pg_get_function_arguments(p.oid) as argument_types,
      CASE p.prokind
        WHEN 'f' THEN 'function'
        WHEN 'p' THEN 'procedure'
        WHEN 'a' THEN 'aggregate'
        WHEN 'w' THEN 'window'
        ELSE 'unknown'
      END as function_type
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = ${schema}
      AND p.prokind IN ('f', 'p', 'a', 'w')
    ORDER BY function_type, function_name
  `;

  const result = await query.execute(db);

  return result.rows.map((row) => ({
    object_name: row.function_name,
    object_type: row.function_type,
    schema_name: row.schema_name,
    details: `${row.return_type}(${row.argument_types})`,
  }));
}

export async function listObjectsTool(input: unknown): Promise<ListObjectsOutput> {
  try {
    const validation = validateInput(ListObjectsInputSchema, input);
    if (!validation.success) {
      return { error: `Input validation failed: ${validation.error}` };
    }

    const validatedInput = validation.data;
    const db = getDb();
    const schema = validatedInput.schema || "public";

    let objects: ObjectInfo[];

    switch (validatedInput.type) {
      case "tables":
        objects = await listTables(db, schema);
        break;
      case "views":
        objects = await listViews(db, schema);
        break;
      case "functions":
        objects = await listFunctions(db, schema);
        break;
    }

    return { objects };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
