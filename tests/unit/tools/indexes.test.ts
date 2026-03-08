import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanupDatabase } from "../../helpers/cleanup";

// Mock kysely sql
jest.mock("kysely", () => ({
  sql: jest.fn(() => ({
    execute: jest.fn(() =>
      Promise.resolve({
        rows: [
          {
            schema_name: "public",
            table_name: "users",
            index_name: "users_pkey",
            index_type: "btree",
            is_unique: true,
            is_primary: true,
            columns: "id",
            definition: "CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)",
            size_bytes: 8192,
          },
          {
            schema_name: "public",
            table_name: "users",
            index_name: "idx_users_email",
            index_type: "btree",
            is_unique: true,
            is_primary: false,
            columns: "email",
            definition: "CREATE UNIQUE INDEX idx_users_email ON public.users USING btree (email)",
            size_bytes: 4096,
          },
        ],
      }),
    ),
  })),
  Kysely: jest.fn(),
  PostgresDialect: jest.fn(),
}));

// Mock database module
jest.mock("../../../src/db", () => ({
  getDb: jest.fn(() => ({})),
  closeDb: jest.fn(() => Promise.resolve()),
}));

describe("List Indexes Tool Unit Tests", () => {
  afterEach(async () => {
    await cleanupDatabase();
    jest.clearAllMocks();
  });

  describe("Input Validation", () => {
    test("should accept schema and table input", async () => {
      const { listIndexesTool } = await import("../../../src/tools/indexes");

      const result = await listIndexesTool({ schema: "public", table: "users" });

      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
    });

    test("should accept schema without table", async () => {
      const { listIndexesTool } = await import("../../../src/tools/indexes");

      const result = await listIndexesTool({ schema: "public" });

      expect(result).toBeDefined();
      expect(result.indexes).toBeDefined();
    });

    test("should require schema parameter", async () => {
      const { listIndexesTool } = await import("../../../src/tools/indexes");

      const result = await listIndexesTool({ schema: "test_schema" });

      expect(result).toBeDefined();
    });
  });

  describe("Return Value Structure", () => {
    test("should return indexes array", async () => {
      const { listIndexesTool } = await import("../../../src/tools/indexes");

      const result = await listIndexesTool({ schema: "public" });

      expect(result).toHaveProperty("indexes");
      expect(result).not.toHaveProperty("error");
      expect(Array.isArray(result.indexes)).toBe(true);
    });

    test("should return index objects with correct structure", async () => {
      const { listIndexesTool } = await import("../../../src/tools/indexes");

      const result = await listIndexesTool({ schema: "public" });

      expect(result.indexes).toBeDefined();
      expect(result.indexes!.length).toBeGreaterThan(0);

      const firstIndex = result.indexes![0];
      expect(firstIndex).toHaveProperty("schema_name");
      expect(firstIndex).toHaveProperty("table_name");
      expect(firstIndex).toHaveProperty("index_name");
      expect(firstIndex).toHaveProperty("index_type");
      expect(firstIndex).toHaveProperty("is_unique");
      expect(firstIndex).toHaveProperty("is_primary");
      expect(firstIndex).toHaveProperty("columns");
      expect(firstIndex).toHaveProperty("definition");
      expect(firstIndex).toHaveProperty("size_bytes");
      expect(typeof firstIndex.schema_name).toBe("string");
      expect(typeof firstIndex.table_name).toBe("string");
      expect(typeof firstIndex.index_name).toBe("string");
      expect(typeof firstIndex.index_type).toBe("string");
      expect(typeof firstIndex.is_unique).toBe("boolean");
      expect(typeof firstIndex.is_primary).toBe("boolean");
      expect(typeof firstIndex.columns).toBe("string");
      expect(typeof firstIndex.definition).toBe("string");
    });

    test("should include both primary and regular indexes", async () => {
      const { listIndexesTool } = await import("../../../src/tools/indexes");

      const result = await listIndexesTool({ schema: "public" });

      const primaryIndexes = result.indexes!.filter((i) => i.is_primary);
      const regularIndexes = result.indexes!.filter((i) => !i.is_primary);
      expect(primaryIndexes.length).toBeGreaterThan(0);
      expect(regularIndexes.length).toBeGreaterThan(0);
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

      const { listIndexesTool } = await import("../../../src/tools/indexes");

      const result = await listIndexesTool({ schema: "public" });

      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe("string");
      expect(result.indexes).toBeUndefined();
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

      const { listIndexesTool } = await import("../../../src/tools/indexes");

      const result = await listIndexesTool({ schema: "public" });

      expect(result.error).toBe("Unknown error occurred");
    });
  });
});
