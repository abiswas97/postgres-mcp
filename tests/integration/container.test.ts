import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import {
  getTestDb,
  isDockerAvailable,
  setupTestContainer,
  teardownTestContainer,
} from "../setup/testcontainer";

function createTestTools(connectionInfo: any) {
  const originalEnv = { ...process.env };

  process.env.DB_HOST = connectionInfo.host;
  process.env.DB_PORT = connectionInfo.port.toString();
  process.env.DB_USER = connectionInfo.username;
  process.env.DB_PASSWORD = connectionInfo.password;
  process.env.DB_NAME = connectionInfo.database;
  process.env.DB_SSL = "false";
  process.env.READ_ONLY = "false";
  process.env.NODE_ENV = "development";

  const modulePaths = [
    "../../src/db",
    "../../src/tools/query",
    "../../src/tools/list",
    "../../src/tools/describe",
    "../../src/tools/schemas",
    "../../src/tools/indexes",
    "../../src/tools/performance",
    "../../src/tools/search",
    "../../src/tools/connections",
    "../../src/tools/diagnostics",
    "../../src/tools/slow-queries",
  ];
  for (const p of modulePaths) delete require.cache[require.resolve(p)];

  const cleanup = () => {
    process.env = originalEnv;
  };

  return {
    cleanup,
    getTools: async () => {
      const { queryTool } = await import("../../src/tools/query");
      const { listObjectsTool } = await import("../../src/tools/list");
      const { describeTableTool } = await import("../../src/tools/describe");
      const { listSchemasTool } = await import("../../src/tools/schemas");
      const { listIndexesTool } = await import("../../src/tools/indexes");
      const { explainQueryTool } = await import("../../src/tools/performance");
      const { searchObjectsTool } = await import("../../src/tools/search");
      const { getConnectionsTool } = await import("../../src/tools/connections");
      const { diagnoseDatabaseTool } = await import("../../src/tools/diagnostics");
      const { getSlowQueriesTool } = await import("../../src/tools/slow-queries");
      const { closeDb } = await import("../../src/db");
      return {
        queryTool,
        listObjectsTool,
        describeTableTool,
        listSchemasTool,
        listIndexesTool,
        explainQueryTool,
        searchObjectsTool,
        getConnectionsTool,
        diagnoseDatabaseTool,
        getSlowQueriesTool,
        closeDb,
      };
    },
  };
}

function createReadOnlyTestTools(connectionInfo: any) {
  const originalEnv = { ...process.env };

  process.env.DB_HOST = connectionInfo.host;
  process.env.DB_PORT = connectionInfo.port.toString();
  process.env.DB_USER = connectionInfo.username;
  process.env.DB_PASSWORD = connectionInfo.password;
  process.env.DB_NAME = connectionInfo.database;
  process.env.DB_SSL = "false";
  process.env.READ_ONLY = "true";
  process.env.NODE_ENV = "development";

  delete require.cache[require.resolve("../../src/db")];
  delete require.cache[require.resolve("../../src/tools/query")];

  return {
    cleanup: () => {
      process.env = originalEnv;
    },
    getTools: async () => {
      const { queryTool } = await import("../../src/tools/query");
      const { closeDb } = await import("../../src/db");
      return { queryTool, closeDb };
    },
  };
}

function createRowLimitTestTools(connectionInfo: any, rowLimit: string) {
  const originalEnv = { ...process.env };

  process.env.DB_HOST = connectionInfo.host;
  process.env.DB_PORT = connectionInfo.port.toString();
  process.env.DB_USER = connectionInfo.username;
  process.env.DB_PASSWORD = connectionInfo.password;
  process.env.DB_NAME = connectionInfo.database;
  process.env.DB_SSL = "false";
  process.env.READ_ONLY = "false";
  process.env.ROW_LIMIT = rowLimit;
  process.env.NODE_ENV = "development";

  delete require.cache[require.resolve("../../src/db")];
  delete require.cache[require.resolve("../../src/tools/query")];

  return {
    cleanup: () => {
      process.env = originalEnv;
    },
    getTools: async () => {
      const { queryTool } = await import("../../src/tools/query");
      const { closeDb } = await import("../../src/db");
      return { queryTool, closeDb };
    },
  };
}

const dockerAvailable = isDockerAvailable();
const describeWithDocker = dockerAvailable ? describe : describe.skip;

describeWithDocker("Testcontainer Integration Tests", () => {
  let containerSetup: Awaited<ReturnType<typeof setupTestContainer>>;

  beforeAll(async () => {
    containerSetup = await setupTestContainer();
  }, 120000);

  afterAll(async () => {
    await teardownTestContainer();
  }, 30000);

  test("should have created test schema and data", async () => {
    const db = getTestDb();

    const schemas = await db
      .selectFrom("information_schema.schemata")
      .select("schema_name")
      .where("schema_name", "=", "testschema")
      .execute();

    expect(schemas).toHaveLength(1);

    const tables = await db
      .selectFrom("information_schema.tables")
      .select("table_name")
      .where("table_schema", "=", "testschema")
      .orderBy("table_name")
      .execute();

    const tableNames = tables.map((t: any) => t.table_name).sort();
    expect(tableNames).toEqual([
      "categories",
      "post_tags",
      "posts",
      "published_posts",
      "tags",
      "users",
    ]);

    const userCount = await db
      .selectFrom("testschema.users")
      .select(db.fn.count("id").as("count"))
      .executeTakeFirst();

    expect(Number(userCount?.count)).toBe(3);
  });

  test("should test all MCP tools with real data", async () => {
    const testTools = createTestTools(containerSetup.connectionInfo);

    try {
      const {
        queryTool,
        listObjectsTool,
        describeTableTool,
        listSchemasTool,
        listIndexesTool,
        explainQueryTool,
        closeDb,
      } = await testTools.getTools();

      const queryResult = await queryTool({
        sql: "SELECT COUNT(*) as count FROM testschema.users",
      });
      expect(queryResult.error).toBeUndefined();
      expect(queryResult.rows).toBeDefined();
      expect(queryResult.rows![0].count).toBe("3");

      const tablesResult = await listObjectsTool({ type: "tables", schema: "testschema" });
      expect(tablesResult.error).toBeUndefined();
      expect(tablesResult.objects).toBeDefined();
      expect(tablesResult.objects!.length).toBe(5);

      const tableNames = tablesResult.objects!.map((t) => t.object_name).sort();
      expect(tableNames).toContain("users");
      expect(tableNames).toContain("posts");
      expect(tableNames).not.toContain("published_posts");

      const describeResult = await describeTableTool({
        schema: "testschema",
        table: "users",
      });
      expect(describeResult.error).toBeUndefined();
      expect(describeResult.columns).toBeDefined();
      expect(describeResult.columns!.length).toBe(6);

      const columnNames = describeResult.columns!.map((c) => c.column_name);
      expect(columnNames).toContain("id");
      expect(columnNames).toContain("name");
      expect(columnNames).toContain("email");

      expect(describeResult.constraints).toBeDefined();
      expect(describeResult.constraints!.length).toBeGreaterThan(0);

      const constraintDefs = describeResult.constraints!.map((c) => c.constraint_definition);
      expect(constraintDefs.some((def) => def.includes("PRIMARY KEY"))).toBe(true);

      const schemasResult = await listSchemasTool({});
      expect(schemasResult.error).toBeUndefined();
      expect(schemasResult.schemas).toBeDefined();
      expect(schemasResult.schemas!.length).toBeGreaterThan(0);

      const schemaNames = schemasResult.schemas!.map((s) => s.schema_name);
      expect(schemaNames).toContain("testschema");
      expect(schemaNames).toContain("public");

      const allSchemasResult = await listSchemasTool({
        includeSystemSchemas: true,
      });
      expect(allSchemasResult.schemas!.length).toBeGreaterThan(schemasResult.schemas!.length);
      expect(allSchemasResult.schemas!.map((s) => s.schema_name)).toContain("information_schema");

      const indexesResult = await listIndexesTool({ schema: "testschema" });
      expect(indexesResult.error).toBeUndefined();
      expect(indexesResult.indexes).toBeDefined();
      expect(indexesResult.indexes!.length).toBeGreaterThan(0);
      expect(
        indexesResult.indexes!.map((i) => i.index_name).some((name) => name.includes("pkey")),
      ).toBe(true);

      const userIndexesResult = await listIndexesTool({
        schema: "testschema",
        table: "users",
      });
      expect(userIndexesResult.indexes).toBeDefined();
      expect(
        userIndexesResult.indexes!.filter((i) => i.table_name === "users").length,
      ).toBeGreaterThan(0);

      const explainResult = await explainQueryTool({
        sql: "SELECT * FROM testschema.users WHERE id = 1",
      });
      expect(explainResult.error).toBeUndefined();
      expect(explainResult.plan).toBeDefined();
      expect(explainResult.plan!.length).toBeGreaterThan(0);

      const explainAnalyzeResult = await explainQueryTool({
        sql: "SELECT COUNT(*) FROM testschema.users",
        analyze: true,
        buffers: true,
      });
      expect(explainAnalyzeResult.error).toBeUndefined();
      expect(explainAnalyzeResult.plan).toBeDefined();

      expect(describeResult.stats).toBeDefined();
      expect(describeResult.stats).not.toBeNull();
      expect(describeResult.stats!.table_name).toBe("users");
      expect(describeResult.stats!.row_count).toBeGreaterThanOrEqual(0);
      expect(describeResult.stats!.table_size_bytes).toBeGreaterThan(0);

      const viewsResult = await listObjectsTool({ type: "views", schema: "testschema" });
      expect(viewsResult.error).toBeUndefined();
      expect(viewsResult.objects!.map((v) => v.object_name)).toContain("published_posts");

      const publishedView = viewsResult.objects!.find((v) => v.object_name === "published_posts");
      expect(publishedView).toBeDefined();
      expect(publishedView!.details).toContain("SELECT");

      const functionsResult = await listObjectsTool({ type: "functions", schema: "testschema" });
      expect(functionsResult.error).toBeUndefined();
      expect(functionsResult.objects).toBeDefined();

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should handle complex queries and joins", async () => {
    const testTools = createTestTools(containerSetup.connectionInfo);

    try {
      const { queryTool, closeDb } = await testTools.getTools();

      const joinQuery = await queryTool({
        sql: `
          SELECT
            u.name as author,
            p.title,
            c.name as category,
            p.view_count
          FROM testschema.users u
          JOIN testschema.posts p ON u.id = p.user_id
          LEFT JOIN testschema.categories c ON p.category_id = c.id
          WHERE p.published = true
          ORDER BY p.view_count DESC
        `,
      });

      expect(joinQuery.error).toBeUndefined();
      expect(joinQuery.rows).toBeDefined();
      expect(joinQuery.rows!.length).toBeGreaterThan(0);

      const firstRow = joinQuery.rows![0];
      expect(firstRow).toHaveProperty("author");
      expect(firstRow).toHaveProperty("title");
      expect(firstRow).toHaveProperty("category");

      const viewQuery = await queryTool({
        sql: "SELECT * FROM testschema.published_posts ORDER BY view_count DESC",
      });

      expect(viewQuery.error).toBeUndefined();
      expect(viewQuery.rows).toBeDefined();
      expect(viewQuery.rows!.length).toBeGreaterThan(0);

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should handle data manipulation operations", async () => {
    const testTools = createTestTools(containerSetup.connectionInfo);

    try {
      const { queryTool, closeDb } = await testTools.getTools();

      const insertResult = await queryTool({
        sql: `
          INSERT INTO testschema.users (name, email, age)
          VALUES ('Test User', 'test@example.com', 28)
          RETURNING id, name, email
        `,
      });

      expect(insertResult.error).toBeUndefined();

      let userId: number;
      if (insertResult.rows && insertResult.rows.length > 0) {
        expect(insertResult.rows.length).toBe(1);
        expect(insertResult.rows[0].name).toBe("Test User");
        userId = insertResult.rows[0].id;
      } else {
        expect(insertResult.rowCount).toBe(1);
        const userQuery = await queryTool({
          sql: "SELECT id FROM testschema.users WHERE email = 'test@example.com'",
        });
        expect(userQuery.error).toBeUndefined();
        userId = userQuery.rows![0].id;
      }

      const updateResult = await queryTool({
        sql: `UPDATE testschema.users SET age = 29 WHERE id = $1`,
        parameters: [userId],
      });

      expect(updateResult.error).toBeUndefined();
      expect(updateResult.rowCount).toBe(1);

      const selectResult = await queryTool({
        sql: `SELECT age FROM testschema.users WHERE id = $1`,
        parameters: [userId],
      });

      expect(selectResult.error).toBeUndefined();
      expect(selectResult.rows![0].age).toBe(29);

      const deleteResult = await queryTool({
        sql: `DELETE FROM testschema.users WHERE id = $1`,
        parameters: [userId],
      });

      expect(deleteResult.error).toBeUndefined();
      expect(deleteResult.rowCount).toBe(1);

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should handle error cases properly", async () => {
    const testTools = createTestTools(containerSetup.connectionInfo);

    try {
      const { queryTool, describeTableTool, closeDb } = await testTools.getTools();

      const invalidQuery = await queryTool({
        sql: "INVALID SQL SYNTAX HERE",
      });

      expect(invalidQuery.error).toBeDefined();
      expect(typeof invalidQuery.error).toBe("string");

      const nonExistentTable = await describeTableTool({
        schema: "testschema",
        table: "nonexistent_table",
      });

      expect(nonExistentTable.error).toBeUndefined();
      expect(nonExistentTable.columns).toBeDefined();
      expect(nonExistentTable.columns!.length).toBe(0);

      const duplicateEmail = await queryTool({
        sql: `
          INSERT INTO testschema.users (name, email, age)
          VALUES ('Duplicate', 'john@example.com', 25)
        `,
      });

      expect(duplicateEmail.error).toBeDefined();
      expect(duplicateEmail.error).toContain("Duplicate value");

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should enforce security restrictions properly", async () => {
    const testTools = createReadOnlyTestTools(containerSetup.connectionInfo);

    try {
      const { queryTool, closeDb } = await testTools.getTools();

      const selectQuery = await queryTool({
        sql: "SELECT COUNT(*) as count FROM testschema.users",
      });
      expect(selectQuery.error).toBeUndefined();
      expect(selectQuery.rows).toBeDefined();

      const insertQuery = await queryTool({
        sql: `INSERT INTO testschema.users (name, email, age) VALUES ('Test', 'test@test.com', 25)`,
      });
      expect(insertQuery.error).toBeDefined();
      expect(insertQuery.error).toContain("read-only mode");

      const updateQuery = await queryTool({
        sql: `UPDATE testschema.users SET age = 30 WHERE id = 1`,
      });
      expect(updateQuery.error).toBeDefined();
      expect(updateQuery.error).toContain("read-only mode");

      const deleteQuery = await queryTool({
        sql: `DELETE FROM testschema.users WHERE id = 1`,
      });
      expect(deleteQuery.error).toBeDefined();
      expect(deleteQuery.error).toContain("read-only mode");

      const dropQuery = await queryTool({
        sql: `DROP TABLE testschema.users`,
      });
      expect(dropQuery.error).toBeDefined();
      expect(dropQuery.error).toMatch(/not allowed|requires READ_ONLY=false and ALLOW_DDL=true/);

      const createQuery = await queryTool({
        sql: `CREATE TABLE test_table (id INT)`,
      });
      expect(createQuery.error).toBeDefined();
      expect(createQuery.error).toMatch(/not allowed|requires READ_ONLY=false and ALLOW_DDL=true/);

      const largeScanQuery = await queryTool({
        sql: "SELECT * FROM testschema.users",
      });
      expect(largeScanQuery.error).toBeUndefined();
      expect(largeScanQuery.rows).toBeDefined();

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should prevent real SQL injection attempts", async () => {
    const testTools = createTestTools(containerSetup.connectionInfo);

    try {
      const { queryTool, closeDb } = await testTools.getTools();

      const injectionResult1 = await queryTool({
        sql: "SELECT * FROM testschema.users WHERE name = $1",
        parameters: ["'; DROP TABLE testschema.users; --"],
      });
      expect(injectionResult1.error).toBeUndefined();
      expect(injectionResult1.rows).toBeDefined();

      const verifyResult1 = await queryTool({
        sql: "SELECT COUNT(*) as count FROM testschema.users",
      });
      expect(verifyResult1.error).toBeUndefined();
      expect(Number(verifyResult1.rows![0].count)).toBeGreaterThanOrEqual(3);

      const injectionResult2 = await queryTool({
        sql: "SELECT name FROM testschema.users WHERE id = $1",
        parameters: ["1 UNION SELECT email FROM testschema.users"],
      });
      expect(injectionResult2.error).toBeDefined();
      expect(injectionResult2.error).toMatch(
        /(invalid input syntax for type integer|Database operation failed)/,
      );

      const injectionResult3 = await queryTool({
        sql: "SELECT * FROM testschema.users WHERE name = $1",
        parameters: ["admin'/**/OR/**/1=1/**/--"],
      });
      expect(injectionResult3.error).toBeUndefined();
      expect(injectionResult3.rows).toBeDefined();

      const injectionResult4 = await queryTool({
        sql: "SELECT * FROM testschema.users WHERE id = $1",
        parameters: ["1' AND (SELECT COUNT(*) FROM testschema.users) > 0 --"],
      });
      expect(injectionResult4.error).toBeDefined();
      expect(injectionResult4.error).toMatch(
        /(invalid input syntax for type integer|Database operation failed)/,
      );

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should enforce WHERE clause validation with real database", async () => {
    const testTools = createTestTools(containerSetup.connectionInfo);

    try {
      const { queryTool, closeDb } = await testTools.getTools();

      const dangerousPatterns = [
        "WHERE 1=1",
        "WHERE TRUE",
        "WHERE '1'='1'",
        "WHERE 1",
        "where 1=1",
      ];

      for (const pattern of dangerousPatterns) {
        const updateResult = await queryTool({
          sql: `UPDATE testschema.users SET age = 999 ${pattern}`,
        });
        expect(updateResult.error).toBeDefined();
        expect(updateResult.error).toContain("WHERE clause");

        const deleteResult = await queryTool({
          sql: `DELETE FROM testschema.users ${pattern}`,
        });
        expect(deleteResult.error).toBeDefined();
        expect(deleteResult.error).toContain("WHERE clause");
      }

      const checkResult = await queryTool({
        sql: "SELECT COUNT(*) as count FROM testschema.users WHERE age = 999",
      });
      expect(checkResult.error).toBeUndefined();
      expect(checkResult.rows![0].count).toBe("0");

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should validate comprehensive dangerous operations with real database", async () => {
    const testTools = createTestTools(containerSetup.connectionInfo);

    try {
      const { queryTool, closeDb } = await testTools.getTools();

      const dangerousOps = [
        "ALTER TABLE testschema.users ADD COLUMN temp_col TEXT",
        "TRUNCATE testschema.users",
        "GRANT ALL ON testschema.users TO public",
        "REVOKE ALL ON testschema.users FROM public",
        "VACUUM testschema.users",
        "ANALYZE testschema.users",
        "CLUSTER testschema.users",
        "REINDEX TABLE testschema.users",
        "COPY testschema.users TO '/tmp/backup.csv'",
        "BACKUP DATABASE testdb TO '/tmp/backup.sql'",
        "RESTORE DATABASE testdb FROM '/tmp/backup.sql'",
        "ATTACH DATABASE '/tmp/other.db' AS other",
        "DETACH DATABASE other",
        "PRAGMA table_info(testschema.users)",
      ];

      for (const operation of dangerousOps) {
        const result = await queryTool({ sql: operation });
        expect(result.error).toBeDefined();
        expect(result.error).toMatch(/not allowed|requires READ_ONLY=false and ALLOW_DDL=true/);
      }

      const verifyResult = await queryTool({
        sql: "SELECT COUNT(*) as count FROM testschema.users",
      });
      expect(verifyResult.error).toBeUndefined();
      expect(Number(verifyResult.rows![0].count)).toBeGreaterThanOrEqual(3);

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should handle row limiting with large result sets", async () => {
    const testTools = createRowLimitTestTools(containerSetup.connectionInfo, "2");

    try {
      const { queryTool, closeDb } = await testTools.getTools();

      const result = await queryTool({
        sql: "SELECT * FROM testschema.users ORDER BY id",
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();

      const limitedResult = await queryTool({
        sql: "SELECT * FROM testschema.users ORDER BY id LIMIT 1",
      });

      expect(limitedResult.error).toBeUndefined();
      expect(limitedResult.rows).toBeDefined();
      expect(limitedResult.rows!.length).toBe(1);

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should search objects across schemas", async () => {
    const testTools = createTestTools(containerSetup.connectionInfo);
    try {
      const { searchObjectsTool, closeDb } = await testTools.getTools();

      const result = await searchObjectsTool({ pattern: "user" });
      expect(result.error).toBeUndefined();
      expect(result.results).toBeDefined();
      expect(result.results!.length).toBeGreaterThan(0);

      const types = [...new Set(result.results!.map((r: any) => r.object_type))];
      expect(types.length).toBeGreaterThan(1);

      const tableOnly = await searchObjectsTool({ pattern: "user", object_types: ["table"] });
      expect(tableOnly.results).toBeDefined();
      expect(tableOnly.results!.every((r: any) => r.object_type === "table")).toBe(true);

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should get active connections", async () => {
    const testTools = createTestTools(containerSetup.connectionInfo);
    try {
      const { getConnectionsTool, closeDb } = await testTools.getTools();

      const result = await getConnectionsTool({ include_queries: true });
      expect(result.error).toBeUndefined();
      expect(result.summary).toBeDefined();
      expect(result.summary!.total).toBeGreaterThan(0);
      expect(result.summary!.max_connections).toBeGreaterThan(0);
      expect(result.connections).toBeDefined();
      expect(result.timestamp).toBeDefined();

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should diagnose database health", async () => {
    const testTools = createTestTools(containerSetup.connectionInfo);
    try {
      const { diagnoseDatabaseTool, closeDb } = await testTools.getTools();

      const result = await diagnoseDatabaseTool({});
      expect(result.error).toBeUndefined();
      expect(result.status).toBeDefined();
      expect(["healthy", "warning", "critical"]).toContain(result.status);
      expect(result.checks).toBeDefined();
      expect(result.checks!.cache_hit_ratio).toBeDefined();
      expect(result.checks!.connection_saturation).toBeDefined();
      expect(result.checks!.database_size).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.timestamp).toBeDefined();

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should get slow queries from pg_stat_statements", async () => {
    const testTools = createTestTools(containerSetup.connectionInfo);
    try {
      const { getSlowQueriesTool, queryTool, closeDb } = await testTools.getTools();

      for (let i = 0; i < 10; i++) {
        await queryTool({ sql: "SELECT * FROM testschema.users" });
      }

      const result = await getSlowQueriesTool({});
      expect(result.extension_installed).toBe(true);
      expect(result.queries).toBeDefined();
      expect(result.queries!.length).toBeGreaterThan(0);

      const filtered = await getSlowQueriesTool({ min_calls: 5, sort_by: "calls" });
      expect(filtered.queries).toBeDefined();

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should detect sequence near limit in diagnostics", async () => {
    const testTools = createTestTools(containerSetup.connectionInfo);
    try {
      const { diagnoseDatabaseTool, closeDb } = await testTools.getTools();

      const result = await diagnoseDatabaseTool({});
      if (result.checks?.sequence_health?.sequences_near_limit) {
        const testSeq = result.checks.sequence_health.sequences_near_limit.find(
          (s: any) => s.name === "test_sequence",
        );
        if (testSeq) {
          expect(Number(testSeq.pct_used)).toBeGreaterThan(75);
        }
      }

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should provide detailed error categorization", async () => {
    const testTools = createTestTools(containerSetup.connectionInfo);

    try {
      const { queryTool, closeDb } = await testTools.getTools();

      const syntaxResult = await queryTool({
        sql: "INVALID SQL SYNTAX HERE",
      });
      expect(syntaxResult.error).toBeDefined();
      expect(syntaxResult.code).toBe("SYNTAX_ERROR");
      expect(syntaxResult.hint).toBeDefined();

      const duplicateResult = await queryTool({
        sql: `INSERT INTO testschema.users (name, email, age) VALUES ('Duplicate', 'john@example.com', 25)`,
      });
      expect(duplicateResult.error).toBeDefined();
      expect(duplicateResult.code).toBe("DUPLICATE_KEY");
      expect(duplicateResult.hint).toBeDefined();

      const fkResult = await queryTool({
        sql: `INSERT INTO testschema.posts (user_id, title, content, category_id, published)
              VALUES (1, 'Test Post', 'Content', 99999, true)`,
      });
      expect(fkResult.error).toBeDefined();
      expect(fkResult.code).toBe("FOREIGN_KEY_VIOLATION");
      expect(fkResult.hint).toBeDefined();

      const relationResult = await queryTool({
        sql: "SELECT * FROM testschema.nonexistent_table",
      });
      expect(relationResult.error).toBeDefined();
      expect(relationResult.code).toBe("RELATION_NOT_FOUND");
      expect(relationResult.hint).toBeDefined();

      const columnResult = await queryTool({
        sql: "SELECT nonexistent_column FROM testschema.users",
      });
      expect(columnResult.error).toBeDefined();
      expect(columnResult.code).toBe("COLUMN_NOT_FOUND");
      expect(columnResult.hint).toBeDefined();

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should verify database health check with real connection", async () => {
    const testTools = createTestTools(containerSetup.connectionInfo);
    let closeDb: (() => Promise<void>) | undefined;
    try {
      const tools = await testTools.getTools();
      closeDb = tools.closeDb;
      const { getDbManager } = await import("../../src/db");

      const health = await getDbManager().healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.error).toBeUndefined();
    } finally {
      await closeDb?.();
      testTools.cleanup();
    }
  });

  test("should reconnect after close with real database", async () => {
    const testTools = createTestTools(containerSetup.connectionInfo);
    let closeDb: (() => Promise<void>) | undefined;
    try {
      const tools = await testTools.getTools();
      closeDb = tools.closeDb;
      const { getDbManager } = await import("../../src/db");

      const result1 = await tools.queryTool({ sql: "SELECT 1 as val" });
      expect(result1.error).toBeUndefined();
      expect(getDbManager().isConnected()).toBe(true);

      await closeDb();
      expect(getDbManager().isConnected()).toBe(false);

      const result2 = await tools.queryTool({ sql: "SELECT 2 as val" });
      expect(result2.error).toBeUndefined();
      expect(getDbManager().isConnected()).toBe(true);
    } finally {
      await closeDb?.();
      testTools.cleanup();
    }
  });

  test("should return correct config for container connection", async () => {
    const testTools = createTestTools(containerSetup.connectionInfo);
    let closeDb: (() => Promise<void>) | undefined;
    try {
      const tools = await testTools.getTools();
      closeDb = tools.closeDb;
      const { getDbManager } = await import("../../src/db");

      const config = getDbManager().getConfig();
      expect(config.host).toBe(containerSetup.connectionInfo.host);
      expect(config.port).toBe(containerSetup.connectionInfo.port);
      expect(config.user).toBe(containerSetup.connectionInfo.username);
      expect(config.database).toBe(containerSetup.connectionInfo.database);
      expect(config.ssl).toBe(false);
    } finally {
      await closeDb?.();
      testTools.cleanup();
    }
  });
});
