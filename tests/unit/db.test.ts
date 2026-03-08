import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanupDatabase } from "../helpers/cleanup";

describe("Database Module", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };

    jest.resetModules();
    delete require.cache[require.resolve("../../src/db")];
  });

  afterEach(async () => {
    await cleanupDatabase();
    process.env = originalEnv;
  });

  describe("Configuration", () => {
    test("should use default values when environment variables are not set", () => {
      // Remove database environment variables
      delete process.env.DB_HOST;
      delete process.env.DB_PORT;
      delete process.env.DB_USER;
      delete process.env.DB_NAME;
      delete process.env.DB_SSL;

      // The module should still load without throwing
      expect(() => require("../../src/db")).not.toThrow();
    });

    test("should handle missing password gracefully", () => {
      delete process.env.DB_PASSWORD;

      // Module loads fine — dotenv.config() repopulates DB_PASSWORD from .env
      // The actual throw happens at getDbManager() time if DB_PASSWORD is truly absent
      expect(() => require("../../src/db")).not.toThrow();
    });
  });

  describe("Config Validation", () => {
    test("should throw when DB_PASSWORD is missing", async () => {
      delete process.env.DB_PASSWORD;

      const { getDbManager } = await import("../../src/db");
      delete process.env.DB_PASSWORD;

      expect(() => getDbManager()).toThrow("DB_PASSWORD environment variable is required");
    });

    test("should parse numeric env vars correctly", async () => {
      process.env.DB_PASSWORD = "test";
      process.env.DB_PORT = "5433";
      process.env.DB_POOL_MAX = "10";
      process.env.DB_IDLE_TIMEOUT = "3000";
      process.env.DB_CONNECTION_TIMEOUT = "5000";
      process.env.DB_QUERY_TIMEOUT = "15000";

      const { getDbManager } = await import("../../src/db");
      const config = getDbManager().getConfig();

      expect(config.port).toBe(5433);
      expect(config.maxConnections).toBe(10);
      expect(config.idleTimeoutMs).toBe(3000);
      expect(config.connectionTimeoutMs).toBe(5000);
      expect(config.queryTimeoutMs).toBe(15000);
    });

    test("should use defaults for all optional env vars", async () => {
      process.env.DB_PASSWORD = "test";
      delete process.env.DB_HOST;
      delete process.env.DB_PORT;
      delete process.env.DB_USER;
      delete process.env.DB_NAME;
      delete process.env.DB_POOL_MAX;
      delete process.env.DB_IDLE_TIMEOUT;
      delete process.env.DB_CONNECTION_TIMEOUT;
      delete process.env.DB_QUERY_TIMEOUT;

      const { getDbManager } = await import("../../src/db");

      delete process.env.DB_HOST;
      delete process.env.DB_PORT;
      delete process.env.DB_USER;
      delete process.env.DB_NAME;
      delete process.env.DB_POOL_MAX;
      delete process.env.DB_IDLE_TIMEOUT;
      delete process.env.DB_CONNECTION_TIMEOUT;
      delete process.env.DB_QUERY_TIMEOUT;
      const config = getDbManager().getConfig();

      expect(config.host).toBe("127.0.0.1");
      expect(config.port).toBe(5432);
      expect(config.user).toBe("postgres");
      expect(config.database).toBe("postgres");
      expect(config.maxConnections).toBe(5);
      expect(config.idleTimeoutMs).toBe(5000);
      expect(config.connectionTimeoutMs).toBe(10000);
      expect(config.queryTimeoutMs).toBe(30000);
    });

    test("getConfig should return a copy, not a reference", async () => {
      process.env.DB_PASSWORD = "test";

      const { getDbManager } = await import("../../src/db");
      const manager = getDbManager();
      const config1 = manager.getConfig();
      const config2 = manager.getConfig();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });
  });

  describe("SSL Configuration Details", () => {
    test("should set rejectUnauthorized true by default when SSL enabled", async () => {
      process.env.DB_PASSWORD = "test";
      delete process.env.DB_SSL;
      delete process.env.DB_SSL_REJECT_UNAUTHORIZED;
      delete process.env.DB_SSL_CA_CERT;
      delete process.env.DB_SSL_ALLOW_SELF_SIGNED;

      const { getDbManager } = await import("../../src/db");
      const config = getDbManager().getConfig();

      expect(config.ssl).toEqual({ rejectUnauthorized: true });
    });

    test("should set rejectUnauthorized false when DB_SSL_REJECT_UNAUTHORIZED=false", async () => {
      process.env.DB_PASSWORD = "test";
      delete process.env.DB_SSL;
      process.env.DB_SSL_REJECT_UNAUTHORIZED = "false";

      const { getDbManager } = await import("../../src/db");
      const config = getDbManager().getConfig();

      expect(config.ssl).toEqual({ rejectUnauthorized: false });
    });

    test("should include CA cert when DB_SSL_CA_CERT is set", async () => {
      process.env.DB_PASSWORD = "test";
      delete process.env.DB_SSL;
      process.env.DB_SSL_CA_CERT = "my-ca-cert-content";

      const { getDbManager } = await import("../../src/db");
      const config = getDbManager().getConfig();

      expect(config.ssl).toEqual(expect.objectContaining({ ca: "my-ca-cert-content" }));
    });

    test("should set rejectUnauthorized false when DB_SSL_ALLOW_SELF_SIGNED=true", async () => {
      process.env.DB_PASSWORD = "test";
      delete process.env.DB_SSL;
      process.env.DB_SSL_ALLOW_SELF_SIGNED = "true";

      const { getDbManager } = await import("../../src/db");
      const config = getDbManager().getConfig();

      expect(config.ssl).toEqual({ rejectUnauthorized: false });
    });

    test("should return false for ssl when DB_SSL=false", async () => {
      process.env.DB_PASSWORD = "test";
      process.env.DB_SSL = "false";

      const { getDbManager } = await import("../../src/db");
      const config = getDbManager().getConfig();

      expect(config.ssl).toBe(false);
    });
  });

  describe("Connection Management", () => {
    test("should implement singleton pattern for database instance", async () => {
      process.env.DB_HOST = "localhost";
      process.env.DB_PASSWORD = "test";

      const { getDb } = await import("../../src/db");

      const db1 = getDb();
      const db2 = getDb();

      expect(db1).toBe(db2);
    });

    test("should create new instance after closing connection", async () => {
      process.env.DB_HOST = "localhost";
      process.env.DB_PASSWORD = "test";

      const { getDb, closeDb } = await import("../../src/db");

      const db1 = getDb();
      await closeDb();
      const db2 = getDb();

      expect(db1).not.toBe(db2);
    });
  });

  describe("Connection State", () => {
    test("isConnected should return false before any getDb call", async () => {
      process.env.DB_PASSWORD = "test";

      const { getDbManager } = await import("../../src/db");
      const manager = getDbManager();

      expect(manager.isConnected()).toBe(false);
    });

    test("isConnected should return true after getDb call", async () => {
      process.env.DB_PASSWORD = "test";

      const { getDbManager, getDb } = await import("../../src/db");
      getDb();

      expect(getDbManager().isConnected()).toBe(true);
    });

    test("isConnected should return false after close", async () => {
      process.env.DB_PASSWORD = "test";

      const { getDbManager, getDb, closeDb } = await import("../../src/db");
      getDb();
      expect(getDbManager().isConnected()).toBe(true);

      await closeDb();
      expect(getDbManager().isConnected()).toBe(false);
    });
  });
});
