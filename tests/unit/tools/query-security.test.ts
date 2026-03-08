import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanupDatabase } from "../../helpers/cleanup";

// Mock kysely sql for security testing
jest.mock("kysely", () => ({
  sql: {
    raw: jest.fn((query: string) => ({
      execute: jest.fn(() => {
        if (query.includes("ERROR")) {
          return Promise.reject(new Error("Mocked SQL error"));
        }
        if (query.toUpperCase().includes("SELECT")) {
          return Promise.resolve({ rows: [{ id: 1, name: "test" }] });
        }
        return Promise.resolve({ numAffectedRows: 1 });
      }),
    })),
  },
  Kysely: jest.fn(),
  PostgresDialect: jest.fn(),
}));

// Mock database module
jest.mock("../../../src/db", () => ({
  getDb: jest.fn(() => ({})),
  closeDb: jest.fn(() => Promise.resolve()),
}));

describe("Query Tool Security Tests", () => {
  beforeAll(() => {
    process.env.READ_ONLY = "false"; // Allow testing of write operations
    process.env.NODE_ENV = "development";
  });

  afterEach(async () => {
    await cleanupDatabase();
    jest.clearAllMocks();
  });

  describe("Dangerous Operations Prevention", () => {
    const dangerousOperations = [
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

    dangerousOperations.forEach((operation) => {
      test(`should block ${operation} operations`, async () => {
        const { queryTool } = await import("../../../src/tools/query");

        const result = await queryTool({
          sql: `${operation} TABLE users`,
        });

        expect(result.error).toBeDefined();
        expect(result.error).toMatch(/not allowed|requires READ_ONLY=false and ALLOW_DDL=true/);
        expect(result.rows).toBeUndefined();
        expect(result.rowCount).toBeUndefined();
      });

      test(`should block ${operation} operations in lowercase`, async () => {
        const { queryTool } = await import("../../../src/tools/query");

        const result = await queryTool({
          sql: `${operation.toLowerCase()} table users`,
        });

        expect(result.error).toBeDefined();
        expect(result.error).toMatch(/not allowed|requires READ_ONLY=false and ALLOW_DDL=true/);
      });

      test(`should block ${operation} operations in mixed case`, async () => {
        const { queryTool } = await import("../../../src/tools/query");

        const mixedCase = operation
          .split("")
          .map((char, i) => (i % 2 === 0 ? char.toLowerCase() : char.toUpperCase()))
          .join("");

        const result = await queryTool({
          sql: `${mixedCase} table users`,
        });

        expect(result.error).toBeDefined();
        expect(result.error).toMatch(/not allowed|requires READ_ONLY=false and ALLOW_DDL=true/);
      });
    });

    test("should block dangerous operations embedded in queries", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users; DROP TABLE users; --",
      });

      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/not allowed|requires READ_ONLY=false and ALLOW_DDL=true/);
    });

    test("should block dangerous operations with comments", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "/* comment */ DROP /* another comment */ TABLE users",
      });

      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/not allowed|requires READ_ONLY=false and ALLOW_DDL=true/);
    });

    test("should block multiple dangerous operations", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "CREATE TABLE temp AS SELECT * FROM users; DROP TABLE temp;",
      });

      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/not allowed|requires READ_ONLY=false and ALLOW_DDL=true/);
    });
  });

  describe("Parameterized Query Security", () => {
    test("should handle string parameters correctly", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE name = $1",
        parameters: ["John Doe"],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should handle numeric parameters correctly", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE id = $1 AND age > $2",
        parameters: [123, 18],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should handle boolean parameters correctly", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE active = $1",
        parameters: [true],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should handle null parameters correctly", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE deleted_at = $1",
        parameters: [null],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should prevent SQL injection through string parameters", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE name = $1",
        parameters: ["'; DROP TABLE users; --"],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
      // Parameter should be escaped, not executed as SQL
    });

    test("should prevent SQL injection through numeric parameters", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE id = $1",
        parameters: ["1; DROP TABLE users; --"],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
      // String should be treated as string, not executed
    });

    test("should handle single quotes in string parameters", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE name = $1",
        parameters: ["O'Connor"],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should handle multiple single quotes in parameters", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE name = $1",
        parameters: ["'''; DROP TABLE users; '''"],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should handle Unicode characters in parameters", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE name = $1",
        parameters: ["José García 中文 🚀"],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should handle backslashes in parameters", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE path = $1",
        parameters: ["C:\\Windows\\System32"],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should handle multiple parameters correctly", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE name = $1 AND email = $2 AND age > $3 AND active = $4",
        parameters: ["John Doe", "john@example.com", 25, true],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should handle out-of-order parameter references", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE email = $2 AND name = $1",
        parameters: ["John Doe", "john@example.com"],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });
  });

  describe("WHERE Clause Security Validation", () => {
    const dangerousWherePatterns = [
      "WHERE 1=1",
      "WHERE 1 = 1",
      "WHERE TRUE",
      "WHERE 1",
      "WHERE '1'='1'",
      'WHERE "1"="1"',
      "where 1=1",
      "WHERE true",
      "WHERE 1 = 1 ",
      " WHERE 1=1 ",
    ];

    dangerousWherePatterns.forEach((pattern) => {
      test(`should block UPDATE with dangerous pattern: ${pattern}`, async () => {
        const { queryTool } = await import("../../../src/tools/query");

        const result = await queryTool({
          sql: `UPDATE users SET name = 'test' ${pattern}`,
        });

        expect(result.error).toBeDefined();
        expect(result.error).toContain("WHERE clause");
      });

      test(`should block DELETE with dangerous pattern: ${pattern}`, async () => {
        const { queryTool } = await import("../../../src/tools/query");

        const result = await queryTool({
          sql: `DELETE FROM users ${pattern}`,
        });

        expect(result.error).toBeDefined();
        expect(result.error).toContain("WHERE clause");
      });
    });

    test("should allow UPDATE with valid WHERE clause", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "UPDATE users SET name = 'test' WHERE id = 123",
      });

      expect(result.error).toBeUndefined();
      expect(result.rowCount).toBe(1);
    });

    test("should allow DELETE with valid WHERE clause", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "DELETE FROM users WHERE id = 123",
      });

      expect(result.error).toBeUndefined();
      expect(result.rowCount).toBe(1);
    });

    test("should allow UPDATE with complex WHERE clause", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "UPDATE users SET name = 'test' WHERE id > 100 AND active = true AND email LIKE '%@example.com'",
      });

      expect(result.error).toBeUndefined();
      expect(result.rowCount).toBe(1);
    });

    test("should allow UPDATE with parameterized WHERE clause", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "UPDATE users SET name = $1 WHERE id = $2",
        parameters: ["Updated Name", 123],
      });

      expect(result.error).toBeUndefined();
      expect(result.rowCount).toBe(1);
    });

    test("should block UPDATE without WHERE clause", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "UPDATE users SET name = 'test'",
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("WHERE clause");
    });

    test("should block DELETE without WHERE clause", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "DELETE FROM users",
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("WHERE clause");
    });
  });

  describe("SQL Injection Prevention", () => {
    test("should prevent SQL injection in basic SELECT", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE name = $1",
        parameters: ["admin'; DROP TABLE users; --"],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should prevent SQL injection in INSERT", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "INSERT INTO users (name, email) VALUES ($1, $2)",
        parameters: ["'; DROP TABLE users; --", "test@example.com"],
      });

      expect(result.error).toBeUndefined();
      expect(result.rowCount).toBe(1);
    });

    test("should prevent SQL injection through UNION attacks", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE id = $1",
        parameters: ["1 UNION SELECT * FROM admin_users"],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
      // Should treat the whole thing as a string parameter
    });

    test("should prevent SQL injection through comment attacks", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE name = $1",
        parameters: ["admin'/**/OR/**/1=1/**/--"],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should prevent blind SQL injection attempts", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE id = $1",
        parameters: ["1' AND (SELECT COUNT(*) FROM users) > 0 --"],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });
  });
});
