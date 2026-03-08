import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanupDatabase } from "../../helpers/cleanup";

const mockSqlTagged = jest.fn(() => ({
  execute: jest.fn(() => Promise.resolve({ rows: [] })),
}));
(mockSqlTagged as any).raw = jest.fn((str: string) => str);

jest.mock("kysely", () => ({
  sql: mockSqlTagged,
  Kysely: jest.fn(),
  PostgresDialect: jest.fn(),
}));

jest.mock("../../../src/db", () => ({
  getDb: jest.fn(() => ({})),
  closeDb: jest.fn(() => Promise.resolve()),
}));

const mockSlowQueries = [
  {
    query: "SELECT * FROM users WHERE id = $1",
    calls: 1500,
    total_time_ms: 45000.5,
    mean_time_ms: 30.0,
    min_time_ms: 0.5,
    max_time_ms: 250.0,
    stddev_time_ms: 15.2,
    rows: 1500,
    shared_blks_hit: 9000,
    shared_blks_read: 1000,
    cache_hit_ratio: 90.0,
    temp_blks_written: 0,
  },
  {
    query: "SELECT * FROM orders JOIN users ON users.id = orders.user_id",
    calls: 500,
    total_time_ms: 30000.0,
    mean_time_ms: 60.0,
    min_time_ms: 5.0,
    max_time_ms: 500.0,
    stddev_time_ms: 45.0,
    rows: 25000,
    shared_blks_hit: 5000,
    shared_blks_read: 3000,
    cache_hit_ratio: 62.5,
    temp_blks_written: 100,
  },
];

function setupMock(options: {
  extensionInstalled?: boolean;
  queryRows?: any[];
  queryError?: Error;
  statsReset?: string | null;
  statsResetError?: boolean;
}) {
  const {
    extensionInstalled = true,
    queryRows = mockSlowQueries,
    queryError,
    statsReset = "2026-01-01 00:00:00+00",
    statsResetError = false,
  } = options;

  const { sql } = require("kysely");
  const mockSql = sql as jest.MockedFunction<typeof sql> & { raw: jest.Mock };
  let callCount = 0;

  mockSql.raw = jest.fn((str: string) => str);
  mockSql.mockImplementation((..._args: any[]) => ({
    execute: jest.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          rows: extensionInstalled ? [{ exists: 1 }] : [],
        });
      }
      if (callCount === 2) {
        if (queryError) {
          return Promise.reject(queryError);
        }
        return Promise.resolve({ rows: queryRows });
      }
      if (callCount === 3) {
        if (queryError && !statsResetError) {
          return Promise.resolve({ rows: queryRows });
        }
        if (statsResetError) {
          return Promise.reject(new Error('relation "pg_stat_statements_info" does not exist'));
        }
        return Promise.resolve({
          rows: statsReset ? [{ stats_reset: statsReset }] : [],
        });
      }
      if (callCount === 4) {
        if (statsResetError) {
          return Promise.reject(new Error('relation "pg_stat_statements_info" does not exist'));
        }
        return Promise.resolve({
          rows: statsReset ? [{ stats_reset: statsReset }] : [],
        });
      }
      return Promise.resolve({ rows: [] });
    }),
  }));
}

describe("Get Slow Queries Tool Unit Tests", () => {
  afterEach(async () => {
    await cleanupDatabase();
    jest.clearAllMocks();
  });

  describe("Extension installed", () => {
    test("should return queries when extension is installed", async () => {
      setupMock({ extensionInstalled: true });
      const { getSlowQueriesTool } = await import("../../../src/tools/slow-queries");
      const result = await getSlowQueriesTool({});

      expect(result.error).toBeUndefined();
      expect(result.extension_installed).toBe(true);
      expect(result.queries).toBeDefined();
      expect(result.queries!.length).toBe(2);
      expect(result.queries![0].calls).toBe(1500);
      expect(result.queries![0].total_time_ms).toBe(45000.5);
      expect(result.stats_reset).toBe("2026-01-01 00:00:00+00");
    });
  });

  describe("Extension not installed", () => {
    test("should return graceful response when extension not installed", async () => {
      setupMock({ extensionInstalled: false });
      const { getSlowQueriesTool } = await import("../../../src/tools/slow-queries");
      const result = await getSlowQueriesTool({});

      expect(result.extension_installed).toBe(false);
      expect(result.hint).toBeDefined();
      expect(result.hint).toContain("pg_stat_statements");
      expect(result.hint).toContain("shared_preload_libraries");
      expect(result.queries).toBeUndefined();
    });
  });

  describe("Sort parameter", () => {
    test("should respect sort_by parameter", async () => {
      setupMock({ extensionInstalled: true });
      const { sql } = require("kysely");
      const { getSlowQueriesTool } = await import("../../../src/tools/slow-queries");
      await getSlowQueriesTool({ sort_by: "mean_time" });

      const calls = (sql as jest.Mock).mock.calls;
      const rawCallArgs = calls.find((c: any[]) => {
        const str = c?.[0]?.[0] || String(c?.[0]);
        return typeof str === "string" && str.includes("pg_stat_statements");
      });
      expect(rawCallArgs).toBeDefined();
    });
  });

  describe("Filtering", () => {
    test("should respect min_calls filter", async () => {
      setupMock({ extensionInstalled: true });
      const { getSlowQueriesTool } = await import("../../../src/tools/slow-queries");
      const result = await getSlowQueriesTool({ min_calls: 10 });

      expect(result.extension_installed).toBe(true);
      expect(result.queries).toBeDefined();
    });
  });

  describe("Query text visibility", () => {
    test("should omit query text when include_query_text is false", async () => {
      setupMock({ extensionInstalled: true });
      const { getSlowQueriesTool } = await import("../../../src/tools/slow-queries");
      const result = await getSlowQueriesTool({ include_query_text: false });

      expect(result.queries).toBeDefined();
      for (const q of result.queries!) {
        expect(q.query).toBeNull();
      }
    });

    test("should include query text by default", async () => {
      setupMock({ extensionInstalled: true });
      const { getSlowQueriesTool } = await import("../../../src/tools/slow-queries");
      const result = await getSlowQueriesTool({});

      expect(result.queries).toBeDefined();
      for (const q of result.queries!) {
        expect(q.query).toBeDefined();
        expect(q.query).not.toBeNull();
      }
    });
  });

  describe("Stats reset handling", () => {
    test("should handle stats_reset failure gracefully", async () => {
      setupMock({ extensionInstalled: true, statsResetError: true });
      const { getSlowQueriesTool } = await import("../../../src/tools/slow-queries");
      const result = await getSlowQueriesTool({});

      expect(result.error).toBeUndefined();
      expect(result.extension_installed).toBe(true);
      expect(result.queries).toBeDefined();
      expect(result.stats_reset).toBeNull();
    });
  });

  describe("PG12 fallback", () => {
    test("should fall back to old column names on PG12", async () => {
      const columnError = new Error('column "total_exec_time" does not exist');
      setupMock({
        extensionInstalled: true,
        queryError: columnError,
      });
      const { getSlowQueriesTool } = await import("../../../src/tools/slow-queries");
      const result = await getSlowQueriesTool({});

      expect(result.error).toBeUndefined();
      expect(result.extension_installed).toBe(true);
      expect(result.queries).toBeDefined();
    });
  });

  describe("Error handling", () => {
    test("should handle database errors gracefully", async () => {
      const { sql } = require("kysely");
      const mockSql = sql as jest.MockedFunction<typeof sql> & { raw: jest.Mock };
      mockSql.raw = jest.fn((str: string) => str);
      mockSql.mockImplementation(() => ({
        execute: jest.fn(() => Promise.reject(new Error("Connection refused"))),
      }));

      const { getSlowQueriesTool } = await import("../../../src/tools/slow-queries");
      const result = await getSlowQueriesTool({});

      expect(result.error).toBe("Connection refused");
      expect(result.extension_installed).toBe(false);
    });

    test("should handle non-Error exceptions", async () => {
      const { sql } = require("kysely");
      const mockSql = sql as jest.MockedFunction<typeof sql> & { raw: jest.Mock };
      mockSql.raw = jest.fn((str: string) => str);
      mockSql.mockImplementation(() => ({
        execute: jest.fn(() => Promise.reject("string error")),
      }));

      const { getSlowQueriesTool } = await import("../../../src/tools/slow-queries");
      const result = await getSlowQueriesTool({});

      expect(result.error).toBe("Unknown error occurred");
    });
  });
});
