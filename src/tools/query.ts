import { sql } from "kysely";
import { getDb } from "../db.js";
import { QueryInputSchema, type QueryOutput, validateInput } from "../validation.js";

const MAX_PAGE_SIZE = parseInt(process.env.MAX_PAGE_SIZE || "500", 10);
const DEFAULT_PAGE_SIZE = parseInt(process.env.DEFAULT_PAGE_SIZE || "100", 10);

function isReadOnlyMode(): boolean {
  return process.env.READ_ONLY !== "false";
}

// Dangerous operations that are never allowed
const DANGEROUS_OPERATIONS = [
  "DROP",
  "CREATE",
  "ALTER",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "VACUUM",
  "ANALYZE",
  "CLUSTER",
  "REINDEX",
  "COPY",
  "BACKUP",
  "RESTORE",
  "ATTACH",
  "DETACH",
  "PRAGMA",
];

function validateSqlSafety(sqlString: string): {
  isValid: boolean;
  error?: string;
} {
  if (!sqlString || typeof sqlString !== "string") {
    return {
      isValid: false,
      error: "SQL query is required and must be a string",
    };
  }

  const trimmedSql = sqlString.trim();
  if (!trimmedSql) {
    return { isValid: false, error: "SQL query cannot be empty" };
  }

  const upperSql = trimmedSql.toUpperCase();

  for (const dangerous of DANGEROUS_OPERATIONS) {
    const regex = new RegExp(`\\b${dangerous}\\b`, "i");
    if (regex.test(upperSql)) {
      return {
        isValid: false,
        error: `Dangerous operation '${dangerous}' is not allowed`,
      };
    }
  }

  if (isReadOnlyMode()) {
    const isReadOnly =
      upperSql.startsWith("SELECT") ||
      upperSql.startsWith("WITH") ||
      upperSql.startsWith("EXPLAIN");

    if (!isReadOnly) {
      return {
        isValid: false,
        error: "Only SELECT, WITH, and EXPLAIN queries are allowed in read-only mode",
      };
    }
  } else {
    // Even in write mode, validate UPDATE and DELETE have WHERE clauses
    if (upperSql.includes("UPDATE") || upperSql.includes("DELETE")) {
      if (!validateWhereClause(upperSql)) {
        return {
          isValid: false,
          error:
            "UPDATE and DELETE operations must include a valid WHERE clause (not WHERE 1=1, WHERE true, etc.)",
        };
      }
    }
  }

  return { isValid: true };
}

function validateWhereClause(upperSql: string): boolean {
  if (!upperSql.includes("WHERE")) {
    return false;
  }

  // Check for dangerous patterns that make WHERE clause ineffective
  const dangerousPatterns = [
    "WHERE 1=1",
    "WHERE 1 = 1",
    "WHERE TRUE",
    "WHERE 1",
    "WHERE '1'='1'",
    'WHERE "1"="1"',
  ];

  for (const pattern of dangerousPatterns) {
    if (upperSql.includes(pattern)) {
      return false;
    }
  }

  return true;
}

function isReadOnlyQuery(sqlString: string): boolean {
  const upperSql = sqlString.trim().toUpperCase();
  return (
    upperSql.startsWith("SELECT") || upperSql.startsWith("WITH") || upperSql.startsWith("EXPLAIN")
  );
}

function isSingleRowAggregate(upperSql: string): boolean {
  // Check if it's an aggregate query that should return a single row
  const hasAggregates =
    upperSql.includes("COUNT(") ||
    upperSql.includes("SUM(") ||
    upperSql.includes("AVG(") ||
    upperSql.includes("MAX(") ||
    upperSql.includes("MIN(");
  const hasGroupBy = upperSql.includes("GROUP BY");

  // Single row aggregate: has aggregates but no GROUP BY
  return hasAggregates && !hasGroupBy;
}

function applyPagination(
  sqlString: string,
  pageSize?: number,
  offset?: number,
): {
  sql: string;
  actualPageSize: number;
  actualOffset: number;
} {
  const upperSql = sqlString.toUpperCase();

  // Don't modify if already has LIMIT or OFFSET
  if (upperSql.includes("LIMIT") || upperSql.includes("OFFSET")) {
    return {
      sql: sqlString,
      actualPageSize: pageSize || DEFAULT_PAGE_SIZE,
      actualOffset: offset || 0,
    };
  }

  // Use client-specified pageSize or default, capped at MAX_PAGE_SIZE
  const actualPageSize = Math.min(pageSize || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const actualOffset = offset || 0;

  // Don't add LIMIT to single-row aggregates
  if (isSingleRowAggregate(upperSql)) {
    return { sql: sqlString, actualPageSize, actualOffset };
  }

  let paginatedSql = `${sqlString.trim()} LIMIT ${actualPageSize}`;
  if (actualOffset > 0) {
    paginatedSql += ` OFFSET ${actualOffset}`;
  }

  return { sql: paginatedSql, actualPageSize, actualOffset };
}

export async function queryTool(input: unknown): Promise<QueryOutput> {
  try {
    const inputValidation = validateInput(QueryInputSchema, input);
    if (!inputValidation.success) {
      return { error: `Input validation failed: ${inputValidation.error}` };
    }

    const validatedInput = inputValidation.data;

    const sqlValidation = validateSqlSafety(validatedInput.sql);
    if (!sqlValidation.isValid) {
      return { error: sqlValidation.error };
    }

    const db = getDb();
    const trimmedSql = validatedInput.sql.trim();

    if (isReadOnlyQuery(trimmedSql)) {
      const {
        sql: paginatedSql,
        actualPageSize,
        actualOffset,
      } = applyPagination(trimmedSql, validatedInput.pageSize, validatedInput.offset);

      let result;
      if (validatedInput.parameters && validatedInput.parameters.length > 0) {
        for (const param of validatedInput.parameters) {
          if (
            param !== null &&
            typeof param !== "string" &&
            typeof param !== "number" &&
            typeof param !== "boolean"
          ) {
            return {
              error: "Invalid parameter type - only string, number, boolean, and null are allowed",
            };
          }
        }

        // Use safer parameter substitution with better escaping than the original approach
        let finalSql = paginatedSql;
        for (let index = 0; index < validatedInput.parameters.length; index++) {
          const param = validatedInput.parameters[index];
          const placeholder = `$${index + 1}`;
          let escapedValue: string;

          if (param === null) {
            escapedValue = "NULL";
          } else if (typeof param === "string") {
            escapedValue = `'${param
              .replace(/'/g, "''")
              .replace(/\\/g, "\\\\")
              .replace(/\0/g, "")}'`;
          } else if (typeof param === "boolean") {
            escapedValue = param ? "TRUE" : "FALSE";
          } else {
            // Numbers - validate they're actually numbers and not NaN/Infinity
            if (!Number.isFinite(param)) {
              return {
                error: "Invalid numeric parameter - must be finite number",
              };
            }
            escapedValue = String(param);
          }

          finalSql = finalSql.replace(new RegExp(`\\${placeholder}\\b`, "g"), escapedValue);
        }

        result = await sql.raw(finalSql).execute(db);
      } else {
        // No parameters - use raw SQL directly
        result = await sql.raw(paginatedSql).execute(db);
      }

      // Determine if there are more rows available
      const hasMore = result.rows.length === actualPageSize;

      return {
        rows: result.rows as Record<string, any>[],
        rowCount: result.rows.length,
        pagination: {
          hasMore,
          pageSize: actualPageSize,
          offset: actualOffset,
        },
      };
    } else {
      // For write operations (when not in read-only mode)
      let result;
      if (validatedInput.parameters && validatedInput.parameters.length > 0) {
        for (const param of validatedInput.parameters) {
          if (
            param !== null &&
            typeof param !== "string" &&
            typeof param !== "number" &&
            typeof param !== "boolean"
          ) {
            return {
              error: "Invalid parameter type - only string, number, boolean, and null are allowed",
            };
          }
        }

        let finalSql = trimmedSql;
        for (let index = 0; index < validatedInput.parameters.length; index++) {
          const param = validatedInput.parameters[index];
          const placeholder = `$${index + 1}`;
          let escapedValue: string;

          if (param === null) {
            escapedValue = "NULL";
          } else if (typeof param === "string") {
            escapedValue = `'${param
              .replace(/'/g, "''")
              .replace(/\\/g, "\\\\")
              .replace(/\0/g, "")}'`;
          } else if (typeof param === "boolean") {
            escapedValue = param ? "TRUE" : "FALSE";
          } else {
            if (!Number.isFinite(param)) {
              return {
                error: "Invalid numeric parameter - must be finite number",
              };
            }
            escapedValue = String(param);
          }

          finalSql = finalSql.replace(new RegExp(`\\${placeholder}\\b`, "g"), escapedValue);
        }

        result = await sql.raw(finalSql).execute(db);
      } else {
        result = await sql.raw(trimmedSql).execute(db);
      }
      return {
        rowCount: result.numAffectedRows ? Number(result.numAffectedRows) : 0,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    let sanitizedError: string;
    let errorCode: string;
    let hint: string | undefined;

    if (errorMessage.includes("syntax error")) {
      sanitizedError = "SQL syntax error - please check your query";
      errorCode = "SYNTAX_ERROR";
      hint =
        "Review your SQL syntax, check for missing keywords, proper quotes, and correct table/column names";
    } else if (
      errorMessage.includes("permission denied") ||
      errorMessage.includes("access denied")
    ) {
      sanitizedError = "Access denied - insufficient permissions";
      errorCode = "PERMISSION_DENIED";
      hint = "Contact your database administrator to grant necessary permissions";
    } else if (
      errorMessage.includes("duplicate key value") ||
      errorMessage.includes("unique constraint")
    ) {
      sanitizedError = "Duplicate value - this record already exists";
      errorCode = "DUPLICATE_KEY";
      hint = "Check for existing records with the same unique values before inserting";
    } else if (errorMessage.includes("foreign key constraint")) {
      sanitizedError = "Foreign key constraint violation";
      errorCode = "FOREIGN_KEY_VIOLATION";
      hint = "Ensure referenced records exist before creating relationships";
    } else if (errorMessage.includes("relation") && errorMessage.includes("does not exist")) {
      sanitizedError = "Table or view does not exist";
      errorCode = "RELATION_NOT_FOUND";
      hint = "Check table name spelling and schema. Use list_tables to see available tables";
    } else if (errorMessage.includes("column") && errorMessage.includes("does not exist")) {
      sanitizedError = "Column does not exist";
      errorCode = "COLUMN_NOT_FOUND";
      hint = "Check column name spelling. Use describe_table to see available columns";
    } else if (errorMessage.includes("timeout") || errorMessage.includes("cancelled")) {
      sanitizedError = "Query timeout - operation took too long";
      errorCode = "TIMEOUT";
      hint = "Try optimizing your query or adding appropriate indexes";
    } else {
      sanitizedError = "Database operation failed";
      errorCode = "DATABASE_ERROR";
      hint = "Check your query syntax and permissions, then try again";
    }

    return {
      error: sanitizedError,
      code: errorCode,
      hint: hint,
    };
  }
}
