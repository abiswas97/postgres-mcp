import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanupDatabase } from "../../helpers/cleanup";

jest.mock("kysely", () => ({
  sql: jest.fn(() => ({
    execute: jest.fn(() =>
      Promise.resolve({
        rows: [],
      }),
    ),
  })),
  Kysely: jest.fn(),
  PostgresDialect: jest.fn(),
}));

jest.mock("../../../src/db", () => ({
  getDb: jest.fn(() => ({})),
  closeDb: jest.fn(() => Promise.resolve()),
}));

describe("List Objects Tool Unit Tests", () => {
  afterEach(async () => {
    await cleanupDatabase();
    jest.clearAllMocks();
  });

  describe("type=tables", () => {
    beforeEach(() => {
      const { sql } = require("kysely");
      const mockSql = sql as jest.MockedFunction<typeof sql>;
      mockSql.mockImplementation(() => ({
        execute: jest.fn(() =>
          Promise.resolve({
            rows: [
              { table_name: "users", table_type: "BASE TABLE", table_schema: "public" },
              { table_name: "posts", table_type: "BASE TABLE", table_schema: "public" },
            ],
          }),
        ),
      }));
    });

    test("should return objects array with table entries", async () => {
      const { listObjectsTool } = await import("../../../src/tools/list");

      const result = await listObjectsTool({ type: "tables", schema: "public" });

      expect(result).toHaveProperty("objects");
      expect(result).not.toHaveProperty("error");
      expect(Array.isArray(result.objects)).toBe(true);
      expect(result.objects!.length).toBe(2);
      expect(result.objects![0].object_name).toBe("users");
      expect(result.objects![0].object_type).toBe("BASE TABLE");
      expect(result.objects![0].schema_name).toBe("public");
    });
  });

  describe("type=views", () => {
    beforeEach(() => {
      const { sql } = require("kysely");
      const mockSql = sql as jest.MockedFunction<typeof sql>;
      mockSql.mockImplementation(() => ({
        execute: jest.fn(() =>
          Promise.resolve({
            rows: [
              {
                table_schema: "public",
                table_name: "user_summary",
                view_definition: "SELECT id, name FROM users",
              },
            ],
          }),
        ),
      }));
    });

    test("should return objects array with view entries", async () => {
      const { listObjectsTool } = await import("../../../src/tools/list");

      const result = await listObjectsTool({ type: "views", schema: "public" });

      expect(result).toHaveProperty("objects");
      expect(result).not.toHaveProperty("error");
      expect(result.objects!.length).toBe(1);
      expect(result.objects![0].object_name).toBe("user_summary");
      expect(result.objects![0].object_type).toBe("VIEW");
      expect(result.objects![0].details).toBe("SELECT id, name FROM users");
    });
  });

  describe("type=functions", () => {
    beforeEach(() => {
      const { sql } = require("kysely");
      const mockSql = sql as jest.MockedFunction<typeof sql>;
      mockSql.mockImplementation(() => ({
        execute: jest.fn(() =>
          Promise.resolve({
            rows: [
              {
                schema_name: "public",
                function_name: "calculate_total",
                return_type: "numeric",
                argument_types: "price numeric, tax_rate numeric",
                function_type: "function",
              },
            ],
          }),
        ),
      }));
    });

    test("should return objects array with function entries", async () => {
      const { listObjectsTool } = await import("../../../src/tools/list");

      const result = await listObjectsTool({ type: "functions", schema: "public" });

      expect(result).toHaveProperty("objects");
      expect(result).not.toHaveProperty("error");
      expect(result.objects!.length).toBe(1);
      expect(result.objects![0].object_name).toBe("calculate_total");
      expect(result.objects![0].object_type).toBe("function");
      expect(result.objects![0].details).toBe("numeric(price numeric, tax_rate numeric)");
    });
  });

  describe("Default schema", () => {
    test("should default to public schema when none provided", async () => {
      const { sql } = await import("kysely");
      const mockSql = sql as jest.MockedFunction<typeof sql>;

      const { listObjectsTool } = await import("../../../src/tools/list");

      await listObjectsTool({ type: "tables" });

      expect(mockSql).toHaveBeenCalled();
    });
  });

  describe("Input Validation", () => {
    test("should reject invalid type", async () => {
      const { listObjectsTool } = await import("../../../src/tools/list");

      const result = await listObjectsTool({ type: "invalid" });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Input validation failed");
    });

    test("should reject missing type", async () => {
      const { listObjectsTool } = await import("../../../src/tools/list");

      const result = await listObjectsTool({});

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Input validation failed");
    });
  });

  describe("Error Handling", () => {
    test("should return error object for failed queries", async () => {
      const { sql } = await import("kysely");
      const mockSql = sql as jest.MockedFunction<typeof sql>;

      mockSql.mockImplementationOnce(
        () =>
          ({
            execute: jest.fn(() => Promise.reject(new Error("Database error"))),
          }) as any,
      );

      const { listObjectsTool } = await import("../../../src/tools/list");

      const result = await listObjectsTool({ type: "tables", schema: "public" });

      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe("string");
      expect(result.objects).toBeUndefined();
    });

    test("should handle non-Error exceptions", async () => {
      const { sql } = await import("kysely");
      const mockSql = sql as jest.MockedFunction<typeof sql>;

      mockSql.mockImplementationOnce(
        () =>
          ({
            execute: jest.fn(() => Promise.reject("string error")),
          }) as any,
      );

      const { listObjectsTool } = await import("../../../src/tools/list");

      const result = await listObjectsTool({ type: "tables", schema: "public" });

      expect(result.error).toBe("Unknown error occurred");
    });
  });
});
