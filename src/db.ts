import * as dotenv from "dotenv";
import { Kysely, PostgresDialect } from "kysely";
import { Pool, type PoolConfig } from "pg";

dotenv.config();

export interface Database {
  [key: string]: any;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  maxConnections: number;
  idleTimeoutMs: number;
  ssl: boolean | { rejectUnauthorized: boolean; ca?: string };
  connectionTimeoutMs: number;
  queryTimeoutMs: number;
}

class DatabaseManager {
  private static instance: DatabaseManager | null = null;
  private db: Kysely<Database> | null = null;
  private pool: Pool | null = null;
  private config: DatabaseConfig;

  private constructor() {
    this.config = this.loadConfig();
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  private loadConfig(): DatabaseConfig {
    if (!process.env.DB_PASSWORD) {
      throw new Error("DB_PASSWORD environment variable is required");
    }

    return {
      host: process.env.DB_HOST || "127.0.0.1",
      port: parseInt(process.env.DB_PORT || "5432", 10),
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || "postgres",
      maxConnections: parseInt(process.env.DB_POOL_MAX || "5", 10),
      idleTimeoutMs: parseInt(process.env.DB_IDLE_TIMEOUT || "5000", 10),
      connectionTimeoutMs: parseInt(process.env.DB_CONNECTION_TIMEOUT || "10000", 10),
      queryTimeoutMs: parseInt(process.env.DB_QUERY_TIMEOUT || "30000", 10),
      ssl: this.buildSSLConfig(),
    };
  }

  private buildSSLConfig(): boolean | { rejectUnauthorized: boolean; ca?: string } {
    if (process.env.DB_SSL === "false") {
      return false;
    }

    const sslConfig: { rejectUnauthorized: boolean; ca?: string } = {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false",
    };

    // Add CA certificate if provided
    if (process.env.DB_SSL_CA_CERT) {
      sslConfig.ca = process.env.DB_SSL_CA_CERT;
    }

    // For when explicitly allowing self-signed certs
    if (process.env.DB_SSL_ALLOW_SELF_SIGNED === "true") {
      sslConfig.rejectUnauthorized = false;
    }

    return sslConfig;
  }

  public getDatabase(): Kysely<Database> {
    if (!this.db) {
      this.connect();
    }
    return this.db!;
  }

  private connect(): void {
    if (this.db) {
      return;
    }

    const poolConfig: PoolConfig = {
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      max: this.config.maxConnections,
      idleTimeoutMillis: this.config.idleTimeoutMs,
      connectionTimeoutMillis: this.config.connectionTimeoutMs,
      statement_timeout: this.config.queryTimeoutMs,
      query_timeout: this.config.queryTimeoutMs,
      ssl: this.config.ssl,
    };

    this.pool = new Pool(poolConfig);

    this.pool.on("error", (err) => {
      console.error("Database pool error:", {
        message: err.message,
        code: (err as any).code,
        timestamp: new Date().toISOString(),
      });
    });

    this.pool.on("connect", () => {
      if (process.env.NODE_ENV === "development") {
        // Database connection established
      }
    });

    this.db = new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: this.pool,
      }),
    });
  }

  public async close(): Promise<void> {
    if (this.db) {
      await this.db.destroy();
      this.db = null;
    }

    if (this.pool && !this.pool.ended) {
      await this.pool.end();
      this.pool = null;
    }
  }

  public async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    try {
      if (!this.db) {
        this.connect();
      }

      await this.db!.selectFrom("information_schema.tables")
        .select("table_name")
        .limit(1)
        .execute();

      return { healthy: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        healthy: false,
        error: errorMessage,
      };
    }
  }

  public getConfig(): DatabaseConfig {
    return { ...this.config }; // Return a copy to prevent modification
  }

  public isConnected(): boolean {
    return this.db !== null && this.pool !== null;
  }
}

export function getDb(): Kysely<Database> {
  return DatabaseManager.getInstance().getDatabase();
}

export async function closeDb(): Promise<void> {
  await DatabaseManager.getInstance().close();
}

export function getDbManager(): DatabaseManager {
  return DatabaseManager.getInstance();
}
