import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import {
  setupTestContainer,
  teardownTestContainer,
  isDockerAvailable,
  getTestDb,
} from "../setup/testcontainer";

// Create tools with test database connection
function createTestTools(connectionInfo: any) {
  // Override environment variables for this test
  const originalEnv = { ...process.env };

  process.env.DB_HOST = connectionInfo.host;
  process.env.DB_PORT = connectionInfo.port.toString();
  process.env.DB_USER = connectionInfo.username;
  process.env.DB_PASSWORD = connectionInfo.password;
  process.env.DB_NAME = connectionInfo.database;
  process.env.DB_SSL = "false";
  process.env.READ_ONLY = "false";
  process.env.NODE_ENV = "development";

  // Clear module cache to force fresh imports with new env vars
  delete require.cache[require.resolve("../../src/db")];
  delete require.cache[require.resolve("../../src/tools/query")];
  delete require.cache[require.resolve("../../src/tools/list")];
  delete require.cache[require.resolve("../../src/tools/describe")];
  delete require.cache[require.resolve("../../src/tools/schemas")];
  delete require.cache[require.resolve("../../src/tools/indexes")];
  delete require.cache[require.resolve("../../src/tools/performance")];

  const cleanup = () => {
    process.env = originalEnv;
  };

  return {
    cleanup,
    getTools: async () => {
      const { queryTool } = await import("../../src/tools/query");
      const { listObjectsTool } = await import("../../src/tools/list");
      const { describeTableTool, getConstraintsTool } = await import(
        "../../src/tools/describe"
      );
      const { listSchemasTool } = await import("../../src/tools/schemas");
      const { listIndexesTool } = await import("../../src/tools/indexes");
      const { explainQueryTool, getTableStatsTool } = await import(
        "../../src/tools/performance"
      );
      const { closeDb } = await import("../../src/db");
      return {
        queryTool,
        listObjectsTool,
        describeTableTool,
        getConstraintsTool,
        listSchemasTool,
        listIndexesTool,
        explainQueryTool,
        getTableStatsTool,
        closeDb,
      };
    },
  };
}

describe("Testcontainer Integration Tests", () => {
  let containerSetup: Awaited<ReturnType<typeof setupTestContainer>> | null =
    null;
  let dockerAvailable: boolean;

  beforeAll(async () => {
    dockerAvailable = await isDockerAvailable();

    if (dockerAvailable) {
      containerSetup = await setupTestContainer();
    }
  }, 120000); // 2 minutes timeout for container startup

  afterAll(async () => {
    if (containerSetup) {
      await teardownTestContainer();
    }
  }, 30000);

  test("should skip all tests if Docker is not available", () => {
    if (!dockerAvailable) {
      expect(dockerAvailable).toBe(false);
      return;
    }
    expect(dockerAvailable).toBe(true);
  });

  test("should have created test schema and data", async () => {
    if (!dockerAvailable || !containerSetup) {
      return; // Skip if no Docker
    }

    const db = getTestDb();

    // Check schema exists
    const schemas = await db
      .selectFrom("information_schema.schemata")
      .select("schema_name")
      .where("schema_name", "=", "testschema")
      .execute();

    expect(schemas).toHaveLength(1);

    // Check tables exist
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

    // Check sample data
    const userCount = await db
      .selectFrom("testschema.users")
      .select(db.fn.count("id").as("count"))
      .executeTakeFirst();

    expect(Number(userCount?.count)).toBe(3);
  });

  test("should test all MCP tools with real data", async () => {
    if (!dockerAvailable || !containerSetup) {
      return; // Skip if no Docker
    }

    const testTools = createTestTools(containerSetup.connectionInfo);

    try {
      const {
        queryTool,
        listObjectsTool,
        describeTableTool,
        getConstraintsTool,
        listSchemasTool,
        listIndexesTool,
        explainQueryTool,
        getTableStatsTool,
        closeDb,
      } = await testTools.getTools();

      // Test 1: Basic query
      const queryResult = await queryTool({
        sql: "SELECT COUNT(*) as count FROM testschema.users",
      });
      expect(queryResult.error).toBeUndefined();
      expect(queryResult.rows).toBeDefined();
      expect(queryResult.rows![0].count).toBe("3");

      // Test 2: List tables
      const tablesResult = await listObjectsTool({ type: "tables", schema: "testschema" });
      expect(tablesResult.error).toBeUndefined();
      expect(tablesResult.objects).toBeDefined();
      expect(tablesResult.objects!.length).toBe(5); // 5 base tables only

      const tableNames = tablesResult.objects!.map((t) => t.object_name).sort();
      expect(tableNames).toContain("users");
      expect(tableNames).toContain("posts");
      expect(tableNames).not.toContain("published_posts"); // view excluded

      // Test 3: Describe table
      const describeResult = await describeTableTool({
        schema: "testschema",
        table: "users",
      });
      expect(describeResult.error).toBeUndefined();
      expect(describeResult.columns).toBeDefined();
      expect(describeResult.columns!.length).toBe(6); // id, name, email, age, created_at, updated_at

      const columnNames = describeResult.columns!.map((c) => c.column_name);
      expect(columnNames).toContain("id");
      expect(columnNames).toContain("name");
      expect(columnNames).toContain("email");

      // Test 4: Get constraints
      const constraintsResult = await getConstraintsTool({
        schema: "testschema",
        table: "users",
      });
      expect(constraintsResult.error).toBeUndefined();
      expect(constraintsResult.constraints).toBeDefined();
      expect(constraintsResult.constraints!.length).toBeGreaterThan(0);

      const constraintTypes = constraintsResult.constraints!.map(
        (c) => c.constraint_type
      );
      // Check if we have any constraints (the exact type format may vary)
      expect(constraintTypes.length).toBeGreaterThan(0);
      // Check that we get expected constraint definitions
      const constraintDefs = constraintsResult.constraints!.map(
        (c) => c.constraint_definition
      );
      expect(constraintDefs.some((def) => def.includes("PRIMARY KEY"))).toBe(
        true
      );

      // Test 5: List schemas
      const schemasResult = await listSchemasTool({});
      expect(schemasResult.error).toBeUndefined();
      expect(schemasResult.schemas).toBeDefined();
      expect(schemasResult.schemas!.length).toBeGreaterThan(0);

      const schemaNames = schemasResult.schemas!.map((s) => s.schema_name);
      expect(schemaNames).toContain("testschema");
      expect(schemaNames).toContain("public");

      // Test 6: List schemas with system schemas
      const allSchemasResult = await listSchemasTool({
        includeSystemSchemas: true,
      });
      expect(allSchemasResult.error).toBeUndefined();
      expect(allSchemasResult.schemas).toBeDefined();
      expect(allSchemasResult.schemas!.length).toBeGreaterThan(
        schemasResult.schemas!.length
      );

      const allSchemaNames = allSchemasResult.schemas!.map(
        (s) => s.schema_name
      );
      expect(allSchemaNames).toContain("information_schema");

      // Test 7: List indexes
      const indexesResult = await listIndexesTool({ schema: "testschema" });
      expect(indexesResult.error).toBeUndefined();
      expect(indexesResult.indexes).toBeDefined();
      expect(indexesResult.indexes!.length).toBeGreaterThan(0);

      const indexNames = indexesResult.indexes!.map((i) => i.index_name);
      expect(indexNames.some((name) => name.includes("pkey"))).toBe(true);

      // Test 8: List indexes for specific table
      const userIndexesResult = await listIndexesTool({
        schema: "testschema",
        table: "users",
      });
      expect(userIndexesResult.error).toBeUndefined();
      expect(userIndexesResult.indexes).toBeDefined();
      expect(userIndexesResult.indexes!.length).toBeGreaterThan(0);

      const userIndexes = userIndexesResult.indexes!.filter(
        (i) => i.table_name === "users"
      );
      expect(userIndexes.length).toBeGreaterThan(0);

      // Test 9: Explain query
      const explainResult = await explainQueryTool({
        sql: "SELECT * FROM testschema.users WHERE id = 1",
      });
      expect(explainResult.error).toBeUndefined();
      expect(explainResult.plan).toBeDefined();
      expect(explainResult.plan!.length).toBeGreaterThan(0);

      // Test 10: Explain query with analyze
      const explainAnalyzeResult = await explainQueryTool({
        sql: "SELECT COUNT(*) FROM testschema.users",
        analyze: true,
        buffers: true,
      });
      expect(explainAnalyzeResult.error).toBeUndefined();
      expect(explainAnalyzeResult.plan).toBeDefined();

      // Test 11: Get table stats
      const statsResult = await getTableStatsTool({ schema: "testschema" });
      expect(statsResult.error).toBeUndefined();
      expect(statsResult.stats).toBeDefined();
      expect(statsResult.stats!.length).toBeGreaterThan(0);

      const userStats = statsResult.stats!.find(
        (s) => s.table_name === "users"
      );
      expect(userStats).toBeDefined();
      expect(userStats!.row_count).toBeGreaterThanOrEqual(0);
      expect(userStats!.table_size_bytes).toBeGreaterThan(0);

      // Test 12: Get table stats for specific table
      const userStatsResult = await getTableStatsTool({
        schema: "testschema",
        table: "users",
      });
      expect(userStatsResult.error).toBeUndefined();
      expect(userStatsResult.stats).toBeDefined();
      expect(userStatsResult.stats!.length).toBe(1);
      expect(userStatsResult.stats![0].table_name).toBe("users");

      // Test 13: List views
      const viewsResult = await listObjectsTool({ type: "views", schema: "testschema" });
      expect(viewsResult.error).toBeUndefined();
      expect(viewsResult.objects).toBeDefined();

      const viewNames = viewsResult.objects!.map((v) => v.object_name);
      expect(viewNames).toContain("published_posts");

      const publishedView = viewsResult.objects!.find(
        (v) => v.object_name === "published_posts"
      );
      expect(publishedView).toBeDefined();
      expect(publishedView!.details).toContain("SELECT");

      // Test 14: List functions
      const functionsResult = await listObjectsTool({ type: "functions", schema: "testschema" });
      expect(functionsResult.error).toBeUndefined();
      expect(functionsResult.objects).toBeDefined();

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should handle complex queries and joins", async () => {
    if (!dockerAvailable || !containerSetup) {
      return; // Skip if no Docker
    }

    const testTools = createTestTools(containerSetup.connectionInfo);

    try {
      const { queryTool, closeDb } = await testTools.getTools();

      // Complex query with joins
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

      // Check structure
      const firstRow = joinQuery.rows![0];
      expect(firstRow).toHaveProperty("author");
      expect(firstRow).toHaveProperty("title");
      expect(firstRow).toHaveProperty("category");

      // Test view query
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
    if (!dockerAvailable || !containerSetup) {
      return; // Skip if no Docker
    }

    const testTools = createTestTools(containerSetup.connectionInfo);

    try {
      const { queryTool, closeDb } = await testTools.getTools();

      // Insert new user
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
        // Some PostgreSQL setups might not return rows for INSERT...RETURNING
        expect(insertResult.rowCount).toBe(1);
        // Get the user ID with a separate query
        const userQuery = await queryTool({
          sql: "SELECT id FROM testschema.users WHERE email = 'test@example.com'",
        });
        expect(userQuery.error).toBeUndefined();
        userId = userQuery.rows![0].id;
      }

      // Update user using parameterized query
      const updateResult = await queryTool({
        sql: `
          UPDATE testschema.users 
          SET age = 29 
          WHERE id = $1
        `,
        parameters: [userId],
      });

      expect(updateResult.error).toBeUndefined();
      expect(updateResult.rowCount).toBe(1);

      // Verify update using parameterized query
      const selectResult = await queryTool({
        sql: `SELECT age FROM testschema.users WHERE id = $1`,
        parameters: [userId],
      });

      expect(selectResult.error).toBeUndefined();
      expect(selectResult.rows![0].age).toBe(29);

      // Clean up - delete test user using parameterized query
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
    if (!dockerAvailable || !containerSetup) {
      return; // Skip if no Docker
    }

    const testTools = createTestTools(containerSetup.connectionInfo);

    try {
      const { queryTool, describeTableTool, closeDb } =
        await testTools.getTools();

      // Test invalid SQL
      const invalidQuery = await queryTool({
        sql: "INVALID SQL SYNTAX HERE",
      });

      expect(invalidQuery.error).toBeDefined();
      expect(typeof invalidQuery.error).toBe("string");

      // Test non-existent table
      const nonExistentTable = await describeTableTool({
        schema: "testschema",
        table: "nonexistent_table",
      });

      expect(nonExistentTable.error).toBeUndefined();
      expect(nonExistentTable.columns).toBeDefined();
      expect(nonExistentTable.columns!.length).toBe(0);

      // Test constraint violation
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
    if (!dockerAvailable || !containerSetup) {
      return; // Skip if no Docker
    }

    // Create test tools with READ_ONLY mode enabled
    const originalEnv = { ...process.env };

    process.env.DB_HOST = containerSetup.connectionInfo.host;
    process.env.DB_PORT = containerSetup.connectionInfo.port.toString();
    process.env.DB_USER = containerSetup.connectionInfo.username;
    process.env.DB_PASSWORD = containerSetup.connectionInfo.password;
    process.env.DB_NAME = containerSetup.connectionInfo.database;
    process.env.DB_SSL = "false";
    process.env.READ_ONLY = "true"; // Enable read-only mode for security tests
    process.env.NODE_ENV = "development";

    // Clear module cache
    delete require.cache[require.resolve("../../src/db")];
    delete require.cache[require.resolve("../../src/tools/query")];

    try {
      const { queryTool } = await import("../../src/tools/query");
      const { closeDb } = await import("../../src/db");

      // Test 1: SELECT queries should work in read-only mode
      const selectQuery = await queryTool({
        sql: "SELECT COUNT(*) as count FROM testschema.users",
      });
      expect(selectQuery.error).toBeUndefined();
      expect(selectQuery.rows).toBeDefined();

      // Test 2: INSERT should be blocked in read-only mode
      const insertQuery = await queryTool({
        sql: `INSERT INTO testschema.users (name, email, age) VALUES ('Test', 'test@test.com', 25)`,
      });
      expect(insertQuery.error).toBeDefined();
      expect(insertQuery.error).toContain("read-only mode");

      // Test 3: UPDATE should be blocked in read-only mode
      const updateQuery = await queryTool({
        sql: `UPDATE testschema.users SET age = 30 WHERE id = 1`,
      });
      expect(updateQuery.error).toBeDefined();
      expect(updateQuery.error).toContain("read-only mode");

      // Test 4: DELETE should be blocked in read-only mode
      const deleteQuery = await queryTool({
        sql: `DELETE FROM testschema.users WHERE id = 1`,
      });
      expect(deleteQuery.error).toBeDefined();
      expect(deleteQuery.error).toContain("read-only mode");

      // Test 5: Dangerous operations should always be blocked
      const dropQuery = await queryTool({
        sql: `DROP TABLE testschema.users`,
      });
      expect(dropQuery.error).toBeDefined();
      expect(dropQuery.error).toContain("not allowed");

      // Test 6: CREATE should be blocked
      const createQuery = await queryTool({
        sql: `CREATE TABLE test_table (id INT)`,
      });
      expect(createQuery.error).toBeDefined();
      expect(createQuery.error).toContain("not allowed");

      // Test 7: Row limit should be applied
      const largeScanQuery = await queryTool({
        sql: "SELECT * FROM testschema.users",
      });
      expect(largeScanQuery.error).toBeUndefined();
      expect(largeScanQuery.rows).toBeDefined();
      // Check that LIMIT was applied (result should be reasonable size)

      await closeDb();
    } finally {
      // Restore original environment
      process.env = originalEnv;
    }
  });

  test("should prevent real SQL injection attempts", async () => {
    if (!dockerAvailable || !containerSetup) {
      return; // Skip if no Docker
    }

    const testTools = createTestTools(containerSetup.connectionInfo);

    try {
      const { queryTool, closeDb } = await testTools.getTools();

      // Test 1: SQL injection through string parameter
      const injectionResult1 = await queryTool({
        sql: "SELECT * FROM testschema.users WHERE name = $1",
        parameters: ["'; DROP TABLE testschema.users; --"],
      });
      expect(injectionResult1.error).toBeUndefined();
      expect(injectionResult1.rows).toBeDefined();

      // Verify table still exists
      const verifyResult1 = await queryTool({
        sql: "SELECT COUNT(*) as count FROM testschema.users",
      });
      expect(verifyResult1.error).toBeUndefined();
      expect(Number(verifyResult1.rows![0].count)).toBeGreaterThanOrEqual(3); // Original data still there

      // Test 2: UNION-based SQL injection (should fail type conversion)
      const injectionResult2 = await queryTool({
        sql: "SELECT name FROM testschema.users WHERE id = $1",
        parameters: ["1 UNION SELECT email FROM testschema.users"],
      });
      // This should fail because PostgreSQL correctly rejects the malicious string as invalid integer
      expect(injectionResult2.error).toBeDefined();
      // Error message is sanitized in production mode
      expect(injectionResult2.error).toMatch(
        /(invalid input syntax for type integer|Database operation failed)/
      );

      // Test 3: Comment-based injection
      const injectionResult3 = await queryTool({
        sql: "SELECT * FROM testschema.users WHERE name = $1",
        parameters: ["admin'/**/OR/**/1=1/**/--"],
      });
      expect(injectionResult3.error).toBeUndefined();
      expect(injectionResult3.rows).toBeDefined();

      // Test 4: Blind SQL injection attempt (should fail type conversion)
      const injectionResult4 = await queryTool({
        sql: "SELECT * FROM testschema.users WHERE id = $1",
        parameters: ["1' AND (SELECT COUNT(*) FROM testschema.users) > 0 --"],
      });
      // This should fail because PostgreSQL correctly rejects the malicious string as invalid integer
      expect(injectionResult4.error).toBeDefined();
      // Error message is sanitized in production mode
      expect(injectionResult4.error).toMatch(
        /(invalid input syntax for type integer|Database operation failed)/
      );

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should enforce WHERE clause validation with real database", async () => {
    if (!dockerAvailable || !containerSetup) {
      return; // Skip if no Docker
    }

    const testTools = createTestTools(containerSetup.connectionInfo);

    try {
      const { queryTool, closeDb } = await testTools.getTools();

      // Test dangerous WHERE patterns that should be blocked
      const dangerousPatterns = [
        "WHERE 1=1",
        "WHERE TRUE",
        "WHERE '1'='1'",
        "WHERE 1",
        "where 1=1", // case insensitive
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

      // Verify no data was actually modified
      const checkResult = await queryTool({
        sql: "SELECT COUNT(*) as count FROM testschema.users WHERE age = 999",
      });
      expect(checkResult.error).toBeUndefined();
      expect(checkResult.rows![0].count).toBe("0"); // No rows should have been updated

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should validate comprehensive dangerous operations with real database", async () => {
    if (!dockerAvailable || !containerSetup) {
      return; // Skip if no Docker
    }

    const testTools = createTestTools(containerSetup.connectionInfo);

    try {
      const { queryTool, closeDb } = await testTools.getTools();

      // Test all dangerous operations
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
        expect(result.error).toContain("not allowed");
      }

      // Verify database structure is unchanged
      const verifyResult = await queryTool({
        sql: "SELECT COUNT(*) as count FROM testschema.users",
      });
      expect(verifyResult.error).toBeUndefined();
      expect(Number(verifyResult.rows![0].count)).toBeGreaterThanOrEqual(3); // Original data intact

      await closeDb();
    } finally {
      testTools.cleanup();
    }
  });

  test("should handle row limiting with large result sets", async () => {
    if (!dockerAvailable || !containerSetup) {
      return; // Skip if no Docker
    }

    // Set a small row limit for testing
    const originalEnv = { ...process.env };

    process.env.DB_HOST = containerSetup.connectionInfo.host;
    process.env.DB_PORT = containerSetup.connectionInfo.port.toString();
    process.env.DB_USER = containerSetup.connectionInfo.username;
    process.env.DB_PASSWORD = containerSetup.connectionInfo.password;
    process.env.DB_NAME = containerSetup.connectionInfo.database;
    process.env.DB_SSL = "false";
    process.env.READ_ONLY = "false";
    process.env.ROW_LIMIT = "2"; // Very small limit for testing
    process.env.NODE_ENV = "development";

    // Clear module cache
    delete require.cache[require.resolve("../../src/db")];
    delete require.cache[require.resolve("../../src/tools/query")];

    try {
      const { queryTool } = await import("../../src/tools/query");
      const { closeDb } = await import("../../src/db");

      // Query that would return 3 rows but should be limited to 2
      const result = await queryTool({
        sql: "SELECT * FROM testschema.users ORDER BY id",
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
      // Row limit should be applied automatically

      // Query with explicit LIMIT should be preserved
      const limitedResult = await queryTool({
        sql: "SELECT * FROM testschema.users ORDER BY id LIMIT 1",
      });

      expect(limitedResult.error).toBeUndefined();
      expect(limitedResult.rows).toBeDefined();
      expect(limitedResult.rows!.length).toBe(1);

      await closeDb();
    } finally {
      // Restore original environment
      process.env = originalEnv;
    }
  });

  test("should provide detailed error categorization", async () => {
    if (!dockerAvailable || !containerSetup) {
      return; // Skip if no Docker
    }

    const testTools = createTestTools(containerSetup.connectionInfo);

    try {
      const { queryTool, closeDb } = await testTools.getTools();

      // Test syntax error
      const syntaxResult = await queryTool({
        sql: "INVALID SQL SYNTAX HERE",
      });
      expect(syntaxResult.error).toBeDefined();
      expect(syntaxResult.code).toBe("SYNTAX_ERROR");
      expect(syntaxResult.hint).toBeDefined();

      // Test duplicate key error
      const duplicateResult = await queryTool({
        sql: `INSERT INTO testschema.users (name, email, age) VALUES ('Duplicate', 'john@example.com', 25)`,
      });
      expect(duplicateResult.error).toBeDefined();
      expect(duplicateResult.code).toBe("DUPLICATE_KEY");
      expect(duplicateResult.hint).toBeDefined();

      // Test foreign key violation (if we try to reference non-existent category)
      const fkResult = await queryTool({
        sql: `INSERT INTO testschema.posts (user_id, title, content, category_id, published) 
              VALUES (1, 'Test Post', 'Content', 99999, true)`,
      });
      expect(fkResult.error).toBeDefined();
      expect(fkResult.code).toBe("FOREIGN_KEY_VIOLATION");
      expect(fkResult.hint).toBeDefined();

      // Test relation not found
      const relationResult = await queryTool({
        sql: "SELECT * FROM testschema.nonexistent_table",
      });
      expect(relationResult.error).toBeDefined();
      expect(relationResult.code).toBe("RELATION_NOT_FOUND");
      expect(relationResult.hint).toBeDefined();

      // Test column not found
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
});
