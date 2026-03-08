import { sql } from "kysely";
import { getDb } from "../db.js";
import { ListSchemasInputSchema, validateInput } from "../validation.js";

export interface SchemaInfo {
  schema_name: string;
  schema_owner: string;
}

export interface ListSchemasOutput {
  schemas?: SchemaInfo[];
  error?: string;
}

export async function listSchemasTool(input: unknown): Promise<ListSchemasOutput> {
  try {
    const validation = validateInput(ListSchemasInputSchema, input);
    if (!validation.success) {
      return { error: `Input validation failed: ${validation.error}` };
    }

    const validatedInput = validation.data;
    const db = getDb();
    const includeSystem = validatedInput.includeSystemSchemas || false;

    let query = sql<SchemaInfo>`
      SELECT 
        schema_name,
        schema_owner
      FROM information_schema.schemata
    `;

    if (!includeSystem) {
      query = sql<SchemaInfo>`
        SELECT 
          schema_name,
          schema_owner
        FROM information_schema.schemata
        WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
          AND schema_name NOT LIKE 'pg_temp_%'
          AND schema_name NOT LIKE 'pg_toast_temp_%'
        ORDER BY schema_name
      `;
    } else {
      query = sql<SchemaInfo>`
        SELECT 
          schema_name,
          schema_owner
        FROM information_schema.schemata
        ORDER BY schema_name
      `;
    }

    const result = await query.execute(db);

    return {
      schemas: result.rows,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
