import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanupDatabase } from "../../helpers/cleanup";

jest.mock("kysely", () => ({
  sql: {
    raw: jest.fn((query: string) => ({
      execute: jest.fn(() => {
        if (query.includes("ERROR")) {
          return Promise.reject(new Error("Mocked SQL error"));
        }
        if (
          query.toUpperCase().startsWith("SELECT") ||
          query.toUpperCase().startsWith("WITH") ||
          query.toUpperCase().startsWith("EXPLAIN")
        ) {
          return Promise.resolve({ rows: [{ id: 1 }] });
        }
        return Promise.resolve({ numAffectedRows: 1 });
      }),
    })),
  },
  Kysely: jest.fn(),
  PostgresDialect: jest.fn(),
}));

jest.mock("../../../src/db", () => ({
  getDb: jest.fn(() => ({})),
  closeDb: jest.fn(() => Promise.resolve()),
}));

describe("Query Tool DDL Mode Tests", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = "development";
  });

  afterEach(async () => {
    await cleanupDatabase();
    jest.clearAllMocks();
    process.env = originalEnv;
  });

  describe("DDL blocked by default (READ_ONLY=true)", () => {
    beforeEach(() => {
      process.env.READ_ONLY = "true";
      delete process.env.ALLOW_DDL;
    });

    const ddlQueries = [
      "CREATE TABLE users (id INT)",
      "ALTER TABLE users ADD COLUMN email TEXT",
      "DROP TABLE users",
      "TRUNCATE users",
      "REINDEX TABLE users",
      "VACUUM users",
      "ANALYZE users",
      "CLUSTER users USING users_pkey",
    ];

    for (const query of ddlQueries) {
      test(`should block '${query.split(" ")[0]}' in read-only mode`, async () => {
        const { queryTool } = await import("../../../src/tools/query");
        const result = await queryTool({ sql: query });
        expect(result.error).toBeDefined();
        expect(result.rows).toBeUndefined();
      });
    }
  });

  describe("DDL blocked when READ_ONLY=false but ALLOW_DDL not set", () => {
    beforeEach(() => {
      process.env.READ_ONLY = "false";
      delete process.env.ALLOW_DDL;
    });

    const ddlQueries = [
      "CREATE TABLE users (id INT)",
      "ALTER TABLE users ADD COLUMN email TEXT",
      "DROP TABLE users",
      "TRUNCATE users",
    ];

    for (const query of ddlQueries) {
      test(`should block '${query.split(" ")[0]}' when ALLOW_DDL not set`, async () => {
        const { queryTool } = await import("../../../src/tools/query");
        const result = await queryTool({ sql: query });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("DDL");
        expect(result.rows).toBeUndefined();
      });
    }
  });

  describe("DDL blocked when ALLOW_DDL=true but READ_ONLY not disabled", () => {
    beforeEach(() => {
      process.env.READ_ONLY = "true";
      process.env.ALLOW_DDL = "true";
    });

    test("should block CREATE when READ_ONLY=true even if ALLOW_DDL=true", async () => {
      const { queryTool } = await import("../../../src/tools/query");
      const result = await queryTool({ sql: "CREATE TABLE users (id INT)" });
      expect(result.error).toBeDefined();
      expect(result.rows).toBeUndefined();
    });
  });

  describe("DDL allowed when READ_ONLY=false AND ALLOW_DDL=true", () => {
    beforeEach(() => {
      process.env.READ_ONLY = "false";
      process.env.ALLOW_DDL = "true";
    });

    const ddlQueries = [
      "CREATE TABLE users (id INT)",
      "ALTER TABLE users ADD COLUMN email TEXT",
      "DROP TABLE users",
      "TRUNCATE users",
      "REINDEX TABLE users",
      "VACUUM users",
      "ANALYZE users",
      "CLUSTER users USING users_pkey",
    ];

    for (const query of ddlQueries) {
      test(`should allow '${query.split(" ")[0]}' when fully unlocked`, async () => {
        const { queryTool } = await import("../../../src/tools/query");
        const result = await queryTool({ sql: query });
        expect(result.error).toBeUndefined();
      });
    }
  });

  describe("Permanently blocked operations never unlock", () => {
    beforeEach(() => {
      process.env.READ_ONLY = "false";
      process.env.ALLOW_DDL = "true";
    });

    const permanentlyBlocked = [
      "GRANT SELECT ON users TO public",
      "REVOKE SELECT ON users FROM public",
      "COPY users TO '/tmp/out.csv'",
      "ATTACH DATABASE '/tmp/db.sqlite' AS other",
    ];

    for (const query of permanentlyBlocked) {
      test(`should always block '${query.split(" ")[0]}'`, async () => {
        const { queryTool } = await import("../../../src/tools/query");
        const result = await queryTool({ sql: query });
        expect(result.error).toBeDefined();
        expect(result.rows).toBeUndefined();
      });
    }
  });
});
