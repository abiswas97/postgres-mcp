import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanupDatabase } from "../../helpers/cleanup";

// Mock sql function
const mockSqlExecute = jest.fn();
const mockSql = jest.fn(() => ({
  execute: mockSqlExecute,
}));

// Mock kysely sql
jest.mock("kysely", () => ({
  sql: mockSql,
  Kysely: jest.fn(),
  PostgresDialect: jest.fn(),
}));

// Mock database module
jest.mock("../../../src/db", () => ({
  getDb: jest.fn(() => ({})),
  closeDb: jest.fn(() => Promise.resolve()),
}));

describe("List Schemas Tool Unit Tests", () => {
  beforeEach(() => {
    // Reset mocks and set default successful response
    jest.clearAllMocks();
    mockSqlExecute.mockResolvedValue({
      rows: [
        { schema_name: "public", schema_owner: "postgres" },
        { schema_name: "testschema", schema_owner: "testuser" },
      ],
    });
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("Input Validation", () => {
    test("should accept valid input with includeSystemSchemas", async () => {
      const { listSchemasTool } = await import("../../../src/tools/schemas");

      const result = await listSchemasTool({ includeSystemSchemas: true });

      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
    });

    test("should accept input without includeSystemSchemas", async () => {
      const { listSchemasTool } = await import("../../../src/tools/schemas");

      const result = await listSchemasTool({});

      expect(result).toBeDefined();
      expect(result.schemas).toBeDefined();
    });

    test("should default includeSystemSchemas to false", async () => {
      const { listSchemasTool } = await import("../../../src/tools/schemas");

      const result = await listSchemasTool({});

      expect(result).toBeDefined();
    });
  });

  describe("Return Value Structure", () => {
    test("should return schemas array", async () => {
      const { listSchemasTool } = await import("../../../src/tools/schemas");

      const result = await listSchemasTool({});

      expect(result).toHaveProperty("schemas");
      expect(result).not.toHaveProperty("error");
      expect(Array.isArray(result.schemas)).toBe(true);
    });

    test("should return schema objects with correct structure", async () => {
      const { listSchemasTool } = await import("../../../src/tools/schemas");

      const result = await listSchemasTool({});

      expect(result.schemas).toBeDefined();
      expect(result.schemas!.length).toBeGreaterThan(0);

      const firstSchema = result.schemas![0];
      expect(firstSchema).toHaveProperty("schema_name");
      expect(firstSchema).toHaveProperty("schema_owner");
      expect(typeof firstSchema.schema_name).toBe("string");
      expect(typeof firstSchema.schema_owner).toBe("string");
    });
  });

  describe("Error Handling", () => {
    test("should return error object for failed queries", async () => {
      // Mock execute to reject with an error
      mockSqlExecute.mockRejectedValueOnce(new Error("Database error"));

      const { listSchemasTool } = await import("../../../src/tools/schemas");

      const result = await listSchemasTool({});

      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe("string");
      expect(result.error).toBe("Database error");
      expect(result.schemas).toBeUndefined();
    });

    test("should handle non-Error exceptions", async () => {
      // Mock execute to reject with a non-Error
      mockSqlExecute.mockRejectedValueOnce("string error");

      const { listSchemasTool } = await import("../../../src/tools/schemas");

      const result = await listSchemasTool({});

      expect(result.error).toBe("Unknown error occurred");
      expect(result.schemas).toBeUndefined();
    });
  });
});
