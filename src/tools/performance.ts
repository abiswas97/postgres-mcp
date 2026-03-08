import { getDb } from "../db.js";
import { sql } from "kysely";
import {
  ExplainQueryInputSchema,
  validateInput,
} from "../validation.js";

export interface ExplainQueryOutput {
  plan?: any[];
  error?: string;
}

export async function explainQueryTool(
  input: unknown
): Promise<ExplainQueryOutput> {
  try {
    const validation = validateInput(ExplainQueryInputSchema, input);
    if (!validation.success) {
      return { error: `Input validation failed: ${validation.error}` };
    }

    const validatedInput = validation.data;
    const db = getDb();

    const trimmedSql = validatedInput.sql.trim().toUpperCase();
    if (
      trimmedSql.includes("INSERT") ||
      trimmedSql.includes("UPDATE") ||
      trimmedSql.includes("DELETE") ||
      trimmedSql.includes("DROP") ||
      trimmedSql.includes("CREATE") ||
      trimmedSql.includes("ALTER") ||
      trimmedSql.includes("TRUNCATE")
    ) {
      return {
        error:
          "EXPLAIN is only allowed for SELECT queries and read-only operations",
      };
    }

    const options = [];
    if (validatedInput.analyze) options.push("ANALYZE true");
    if (validatedInput.buffers) options.push("BUFFERS true");
    if (validatedInput.costs !== false) options.push("COSTS true");
    if (validatedInput.format) {
      const validFormats = ["TEXT", "JSON", "XML", "YAML"];
      const upperFormat = validatedInput.format.toUpperCase();
      if (validFormats.includes(upperFormat)) {
        options.push(`FORMAT ${upperFormat}`);
      }
    }

    const optionsStr = options.length > 0 ? `(${options.join(", ")})` : "";

    const explainSql = `EXPLAIN ${optionsStr} ${validatedInput.sql}`;
    const result = await sql.raw(explainSql).execute(db);

    return {
      plan: result.rows,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
