import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { createTestEnvironment, withDocker } from "../helpers/test-db";
import { teardownTestContainer } from "../setup/testcontainer";

describe("Pagination Integration Tests", () => {
  let testEnv: Awaited<ReturnType<typeof createTestEnvironment>> | null = null;

  beforeAll(async () => {
    // Set environment for write operations
    process.env.READ_ONLY = "false";
    process.env.NODE_ENV = "development";
    process.env.MAX_PAGE_SIZE = "500";
    process.env.DEFAULT_PAGE_SIZE = "100";

    try {
      testEnv = await createTestEnvironment();
    } catch (_error) {
      // Docker not available - tests will be skipped
      testEnv = null;
    }
  }, 120000); // 2 minutes timeout

  afterAll(async () => {
    if (testEnv) {
      testEnv.cleanup();
      await teardownTestContainer();
    }
  }, 30000);

  describe("Real Database Pagination", () => {
    test("should paginate through users table with different page sizes", async () => {
      await withDocker(async () => {
        if (!testEnv) return;

        const { queryTool, closeDb } = await testEnv.getTools();

        try {
          // First, insert more test data for pagination testing
          await queryTool({
            sql: `
              INSERT INTO testschema.users (name, email, age) VALUES 
              ('User4', 'user4@example.com', 28),
              ('User5', 'user5@example.com', 32),
              ('User6', 'user6@example.com', 26),
              ('User7', 'user7@example.com', 30),
              ('User8', 'user8@example.com', 24)
            `,
          });

          // Test page size 2 with offset 0
          const page1 = await queryTool({
            sql: "SELECT * FROM testschema.users ORDER BY id",
            pageSize: 2,
            offset: 0,
          });

          expect(page1.error).toBeUndefined();
          expect(page1.rows).toBeDefined();
          expect(page1.rows!.length).toBe(2);
          expect(page1.pagination?.pageSize).toBe(2);
          expect(page1.pagination?.offset).toBe(0);
          expect(page1.pagination?.hasMore).toBe(true);

          // Test page size 2 with offset 2
          const page2 = await queryTool({
            sql: "SELECT * FROM testschema.users ORDER BY id",
            pageSize: 2,
            offset: 2,
          });

          expect(page2.error).toBeUndefined();
          expect(page2.rows).toBeDefined();
          expect(page2.rows!.length).toBe(2);
          expect(page2.pagination?.pageSize).toBe(2);
          expect(page2.pagination?.offset).toBe(2);
          expect(page2.pagination?.hasMore).toBe(true);

          // Verify different users in different pages
          expect(page1.rows![0].id).not.toBe(page2.rows![0].id);

          await closeDb();
        } finally {
          // Cleanup test data
          await queryTool({
            sql: "DELETE FROM testschema.users WHERE email LIKE $1",
            parameters: ["user%@example.com"],
          });
        }
      });
    });

    test("should handle large page sizes correctly", async () => {
      await withDocker(async () => {
        if (!testEnv) return;

        const { queryTool, closeDb } = await testEnv.getTools();

        try {
          // Test with page size larger than result set
          const result = await queryTool({
            sql: "SELECT * FROM testschema.users ORDER BY id",
            pageSize: 100, // Much larger than the 3 users in test data
          });

          expect(result.error).toBeUndefined();
          expect(result.rows).toBeDefined();
          expect(result.rows!.length).toBe(3); // Only 3 users exist
          expect(result.pagination?.pageSize).toBe(100);
          expect(result.pagination?.offset).toBe(0);
          expect(result.pagination?.hasMore).toBe(false); // Less than page size, so no more

          await closeDb();
        } finally {
          // No cleanup needed
        }
      });
    });

    test("should enforce maximum page size limit", async () => {
      await withDocker(async () => {
        if (!testEnv) return;

        const { queryTool, closeDb } = await testEnv.getTools();

        try {
          // Test with page size exceeding maximum (should be rejected by validation)
          const result = await queryTool({
            sql: "SELECT * FROM testschema.users",
            pageSize: 501, // Exceeds MAX_PAGE_SIZE of 500
          });

          expect(result.error).toBeDefined();
          expect(result.error).toContain("Input validation failed");

          await closeDb();
        } finally {
          // No cleanup needed
        }
      });
    });

    test("should work with complex queries and joins", async () => {
      await withDocker(async () => {
        if (!testEnv) return;

        const { queryTool, closeDb } = await testEnv.getTools();

        try {
          // Test pagination with complex join query
          const result = await queryTool({
            sql: `
              SELECT 
                u.name as author,
                p.title,
                c.name as category
              FROM testschema.users u
              JOIN testschema.posts p ON u.id = p.user_id
              LEFT JOIN testschema.categories c ON p.category_id = c.id
              WHERE p.published = true
              ORDER BY p.view_count DESC
            `,
            pageSize: 2,
          });

          expect(result.error).toBeUndefined();
          expect(result.rows).toBeDefined();
          expect(result.pagination?.pageSize).toBe(2);
          expect(result.pagination?.offset).toBe(0);

          // Verify join results structure
          if (result.rows!.length > 0) {
            expect(result.rows![0]).toHaveProperty("author");
            expect(result.rows![0]).toHaveProperty("title");
            expect(result.rows![0]).toHaveProperty("category");
          }

          await closeDb();
        } finally {
          // No cleanup needed
        }
      });
    });

    test("should handle aggregates with GROUP BY correctly", async () => {
      await withDocker(async () => {
        if (!testEnv) return;

        const { queryTool, closeDb } = await testEnv.getTools();

        try {
          // Test pagination with GROUP BY (should apply pagination)
          const result = await queryTool({
            sql: `
              SELECT 
                c.name as category,
                COUNT(p.id) as post_count
              FROM testschema.categories c
              LEFT JOIN testschema.posts p ON c.id = p.category_id
              GROUP BY c.id, c.name
              ORDER BY post_count DESC
            `,
            pageSize: 1,
          });

          expect(result.error).toBeUndefined();
          expect(result.rows).toBeDefined();
          expect(result.rows!.length).toBe(1); // Limited by page size
          expect(result.pagination?.pageSize).toBe(1);

          await closeDb();
        } finally {
          // No cleanup needed
        }
      });
    });

    test("should not paginate single-row aggregates", async () => {
      await withDocker(async () => {
        if (!testEnv) return;

        const { queryTool, closeDb } = await testEnv.getTools();

        try {
          // Test single-row aggregate (should not apply pagination)
          const result = await queryTool({
            sql: "SELECT COUNT(*) as total_users FROM testschema.users",
            pageSize: 1,
          });

          expect(result.error).toBeUndefined();
          expect(result.rows).toBeDefined();
          expect(result.rows!.length).toBe(1);
          expect(result.rows![0].total_users).toBe("3");
          expect(result.pagination?.pageSize).toBe(1); // Reports requested size

          await closeDb();
        } finally {
          // No cleanup needed
        }
      });
    });

    test("should preserve existing LIMIT and OFFSET in queries", async () => {
      await withDocker(async () => {
        if (!testEnv) return;

        const { queryTool, closeDb } = await testEnv.getTools();

        try {
          // Test query with existing LIMIT
          const result1 = await queryTool({
            sql: "SELECT * FROM testschema.users ORDER BY id LIMIT 1",
            pageSize: 5,
          });

          expect(result1.error).toBeUndefined();
          expect(result1.rows).toBeDefined();
          expect(result1.rows!.length).toBe(1); // Existing LIMIT should be preserved
          expect(result1.pagination?.pageSize).toBe(5); // Reports requested size

          // Test query with existing OFFSET
          const result2 = await queryTool({
            sql: "SELECT * FROM testschema.users ORDER BY id OFFSET 1",
            offset: 0,
          });

          expect(result2.error).toBeUndefined();
          expect(result2.rows).toBeDefined();
          expect(result2.pagination?.offset).toBe(0); // Reports requested offset

          await closeDb();
        } finally {
          // No cleanup needed
        }
      });
    });

    test("should work with parameterized queries", async () => {
      await withDocker(async () => {
        if (!testEnv) return;

        const { queryTool, closeDb } = await testEnv.getTools();

        try {
          // Test pagination with parameters
          const result = await queryTool({
            sql: "SELECT * FROM testschema.users WHERE age > $1 ORDER BY id",
            parameters: [20],
            pageSize: 2,
            offset: 0,
          });

          expect(result.error).toBeUndefined();
          expect(result.rows).toBeDefined();
          expect(result.pagination?.pageSize).toBe(2);
          expect(result.pagination?.offset).toBe(0);

          // All returned users should have age > 20
          result.rows!.forEach((user: any) => {
            expect(user.age).toBeGreaterThan(20);
          });

          await closeDb();
        } finally {
          // No cleanup needed
        }
      });
    });

    test("should handle zero results correctly", async () => {
      await withDocker(async () => {
        if (!testEnv) return;

        const { queryTool, closeDb } = await testEnv.getTools();

        try {
          // Query that returns no results
          const result = await queryTool({
            sql: "SELECT * FROM testschema.users WHERE age > $1",
            parameters: [100], // No users older than 100
            pageSize: 10,
          });

          expect(result.error).toBeUndefined();
          expect(result.rows).toBeDefined();
          expect(result.rows!.length).toBe(0);
          expect(result.pagination?.pageSize).toBe(10);
          expect(result.pagination?.offset).toBe(0);
          expect(result.pagination?.hasMore).toBe(false);

          await closeDb();
        } finally {
          // No cleanup needed
        }
      });
    });

    test("should handle large offsets gracefully", async () => {
      await withDocker(async () => {
        if (!testEnv) return;

        const { queryTool, closeDb } = await testEnv.getTools();

        try {
          // Query with offset larger than total rows
          const result = await queryTool({
            sql: "SELECT * FROM testschema.users ORDER BY id",
            pageSize: 5,
            offset: 100, // Much larger than 3 users
          });

          expect(result.error).toBeUndefined();
          expect(result.rows).toBeDefined();
          expect(result.rows!.length).toBe(0); // No results beyond offset
          expect(result.pagination?.pageSize).toBe(5);
          expect(result.pagination?.offset).toBe(100);
          expect(result.pagination?.hasMore).toBe(false);

          await closeDb();
        } finally {
          // No cleanup needed
        }
      });
    });
  });

  describe("Pagination with Security Features", () => {
    test("should work with READ_ONLY mode", async () => {
      await withDocker(async () => {
        if (!testEnv) return;

        // Temporarily enable READ_ONLY mode
        const originalReadOnly = process.env.READ_ONLY;
        process.env.READ_ONLY = "true";

        // Clear module cache to reload with new env
        jest.resetModules();
        const { queryTool } = await import("../../src/tools/query");
        const { closeDb } = await import("../../src/db");

        try {
          // Test SELECT with pagination in read-only mode
          const result = await queryTool({
            sql: "SELECT * FROM testschema.users ORDER BY id",
            pageSize: 2,
          });

          expect(result.error).toBeUndefined();
          expect(result.rows).toBeDefined();
          expect(result.pagination?.pageSize).toBe(2);

          // Test that write operations are still blocked
          const writeResult = await queryTool({
            sql: "INSERT INTO testschema.users (name, email, age) VALUES ($1, $2, $3)",
            parameters: ["Test", "test@test.com", 25],
            pageSize: 1,
          });

          expect(writeResult.error).toBeDefined();
          expect(writeResult.error).toContain("read-only mode");

          await closeDb();
        } finally {
          // Restore original READ_ONLY setting
          process.env.READ_ONLY = originalReadOnly;
        }
      });
    });

    test("should block dangerous operations regardless of pagination", async () => {
      await withDocker(async () => {
        if (!testEnv) return;

        const { queryTool, closeDb } = await testEnv.getTools();

        try {
          // Test that dangerous operations are blocked even with pagination
          const result = await queryTool({
            sql: "DROP TABLE testschema.users",
            pageSize: 1,
          });

          expect(result.error).toBeDefined();
          expect(result.error).toContain("not allowed");

          await closeDb();
        } finally {
          // No cleanup needed
        }
      });
    });
  });
});
