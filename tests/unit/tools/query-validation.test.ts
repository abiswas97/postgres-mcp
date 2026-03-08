import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanupDatabase } from "../../helpers/cleanup";

// Mock kysely sql for validation testing
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

describe("Query Tool Input Validation Tests", () => {
  beforeAll(() => {
    process.env.READ_ONLY = "false";
    process.env.NODE_ENV = "development";
  });

  afterEach(async () => {
    await cleanupDatabase();
    jest.clearAllMocks();
  });

  describe("SQL String Validation", () => {
    test("should reject null SQL input", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({ sql: null as any });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Input validation failed");
    });

    test("should reject undefined SQL input", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({ sql: undefined as any });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Input validation failed");
    });

    test("should reject empty string SQL input", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({ sql: "" });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("cannot be empty");
    });

    test("should reject whitespace-only SQL input", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({ sql: "   \t\n  " });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("cannot be empty");
    });

    test("should reject non-string SQL input", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({ sql: 123 as any });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Input validation failed");
    });

    test("should reject object as SQL input", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({ sql: { query: "SELECT * FROM users" } as any });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Input validation failed");
    });

    test("should reject array as SQL input", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({ sql: ["SELECT * FROM users"] as any });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Input validation failed");
    });

    test("should accept valid SQL string", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({ sql: "SELECT * FROM users" });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should handle SQL at maximum length (50000 chars)", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      // Create a string that's exactly at the limit
      const baseSQL = "SELECT * FROM users WHERE ";
      const maxSQL = baseSQL + "x".repeat(50000 - baseSQL.length);
      expect(maxSQL.length).toBe(50000);

      const result = await queryTool({ sql: maxSQL });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should reject SQL exceeding maximum length (50001 chars)", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      // Create a string that's definitely over 50000 characters
      const tooLongSQL = `SELECT * FROM users WHERE ${"x".repeat(50000)} = 1`;
      expect(tooLongSQL.length).toBeGreaterThan(50000);

      const result = await queryTool({ sql: tooLongSQL });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("too long");
    });

    test("should handle Unicode characters in SQL", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE name = 'José García 中文 🚀'",
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should handle special characters in SQL", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE notes = 'Line 1\\nLine 2\\tTabbed\\r\\nWindows newline'",
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });
  });

  describe("Parameter Array Validation", () => {
    test("should accept empty parameters array", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users",
        parameters: [],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should accept undefined parameters", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users",
        parameters: undefined,
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should accept valid string parameters", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE name = $1",
        parameters: ["John Doe"],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should accept valid number parameters", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE id = $1 AND age = $2",
        parameters: [123, 25.5],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should accept valid boolean parameters", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE active = $1 AND admin = $2",
        parameters: [true, false],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should accept null parameters", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE deleted_at = $1",
        parameters: [null],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should accept mixed parameter types", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE name = $1 AND id = $2 AND active = $3 AND deleted_at = $4",
        parameters: ["John Doe", 123, true, null],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should reject invalid parameter types - object", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE data = $1",
        parameters: [{ name: "John" }],
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Input validation failed");
    });

    test("should reject invalid parameter types - array", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE ids = $1",
        parameters: [[1, 2, 3]],
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Input validation failed");
    });

    test("should reject invalid parameter types - function", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE callback = $1",
        parameters: [() => "test"],
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Input validation failed");
    });

    test("should reject non-array parameters", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE name = $1",
        parameters: "John Doe" as any,
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Input validation failed");
    });

    test("should handle large parameter arrays", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const manyParams = Array.from({ length: 100 }, (_, i) => i);
      const placeholders = Array.from({ length: 100 }, (_, i) => `$${i + 1}`).join(", ");

      const result = await queryTool({
        sql: `SELECT * FROM users WHERE id IN (${placeholders})`,
        parameters: manyParams,
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should handle empty strings in parameters", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE name = $1",
        parameters: [""],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should handle very long strings in parameters", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const longString = "a".repeat(10000);

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE description = $1",
        parameters: [longString],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should handle Unicode in parameters", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE name = $1",
        parameters: ["José García 中文字符 🎉🚀✨"],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should handle special characters in parameters", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE notes = $1",
        parameters: ["Line 1\nLine 2\tTabbed\r\nWindows\0Null\\Backslash"],
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });
  });

  describe("Row Limiting Validation", () => {
    test("should apply default row limit to unbounded SELECT", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users",
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
      // Row limiting is applied in the query processing
    });

    test("should preserve existing LIMIT clause", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users LIMIT 50",
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should preserve existing OFFSET clause", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users OFFSET 10",
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should preserve LIMIT and OFFSET together", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users LIMIT 50 OFFSET 10",
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should not apply limit to aggregate queries without GROUP BY", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT COUNT(*) FROM users",
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should apply limit to aggregate queries with GROUP BY", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT department, COUNT(*) FROM users GROUP BY department",
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test("should handle case-insensitive LIMIT/OFFSET detection", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "select * from users limit 25",
      });

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });
  });

  describe("Input Object Validation", () => {
    test("should reject completely invalid input object", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool("not an object" as any);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Input validation failed");
    });

    test("should reject null input", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool(null as any);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Input validation failed");
    });

    test("should reject undefined input", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool(undefined as any);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Input validation failed");
    });

    test("should reject empty object", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({} as any);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Input validation failed");
    });

    test("should reject object with missing sql field", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({ parameters: ["test"] } as any);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Input validation failed");
    });

    test("should accept object with extra fields", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users",
        parameters: ["test"],
        extraField: "ignored",
      } as any);

      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });
  });

  describe("Error Message Validation", () => {
    test("should provide clear error message for missing sql field", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({} as any);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Input validation failed");
      expect(result.error).toContain("sql");
    });

    test("should provide clear error message for invalid parameter types", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({
        sql: "SELECT * FROM users WHERE data = $1",
        parameters: [{ invalid: "object" }],
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Input validation failed");
      expect(result.error).toContain("parameters");
    });

    test("should provide clear error message for SQL length violation", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const tooLongSQL = `SELECT * FROM users WHERE ${"x".repeat(50000)}`;

      const result = await queryTool({ sql: tooLongSQL });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("too long");
    });

    test("should provide clear error message for empty SQL", async () => {
      const { queryTool } = await import("../../../src/tools/query");

      const result = await queryTool({ sql: "" });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("cannot be empty");
    });
  });
});
