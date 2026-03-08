import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

// Get directory path for file loading
const getCurrentDir = () => path.dirname(__filename);

export interface TestDatabase {
  [key: string]: any;
}

let container: StartedPostgreSqlContainer | null = null;
let db: Kysely<TestDatabase> | null = null;

export async function isDockerAvailable(): Promise<boolean> {
  try {
    // Try to create a container to check if Docker is available
    await new PostgreSqlContainer().start().then(c => c.stop());
    return true;
  } catch (error) {
    return false;
  }
}

export async function setupTestContainer(): Promise<{
  container: StartedPostgreSqlContainer;
  db: Kysely<TestDatabase>;
  connectionInfo: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  };
}> {
  if (!(await isDockerAvailable())) {
    throw new Error('Docker is not available. Testcontainer tests require Docker to be running.');
  }

  // Start PostgreSQL container
  container = await new PostgreSqlContainer('postgres:15')
    .withDatabase('testdb')
    .withUsername('testuser')
    .withPassword('testpass')
    .withCommand([
      'postgres',
      '-c', 'shared_preload_libraries=pg_stat_statements',
      '-c', 'pg_stat_statements.track=all'
    ])
    .start();

  const connectionInfo = {
    host: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
  };

  // Create Kysely instance
  const pool = new Pool({
    host: connectionInfo.host,
    port: connectionInfo.port,
    user: connectionInfo.username,
    password: connectionInfo.password,
    database: connectionInfo.database,
    max: 5,
    idleTimeoutMillis: 30000,
  });

  db = new Kysely<TestDatabase>({
    dialect: new PostgresDialect({
      pool,
    }),
  });

  // Set up schema and data
  await setupTestSchema(db);
  await loadSampleData(db);
  await sql.raw('CREATE EXTENSION IF NOT EXISTS pg_stat_statements').execute(db);

  return { container, db, connectionInfo };
}

export async function teardownTestContainer(): Promise<void> {
  if (db) {
    await db.destroy();
    db = null;
  }
  if (container) {
    await container.stop();
    container = null;
  }
}

async function setupTestSchema(db: Kysely<TestDatabase>): Promise<void> {
  const schemaPath = path.join(getCurrentDir(), '../fixtures/test-schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  
  // Split by semicolon and execute each statement
  const statements = schema
    .split(';')
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0);

  for (const statement of statements) {
    await sql.raw(statement).execute(db);
  }
}

async function loadSampleData(db: Kysely<TestDatabase>): Promise<void> {
  const dataPath = path.join(getCurrentDir(), '../fixtures/sample-data.sql');
  const data = fs.readFileSync(dataPath, 'utf-8');
  
  // Split by semicolon and execute each statement
  const statements = data
    .split(';')
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0);

  for (const statement of statements) {
    await sql.raw(statement).execute(db);
  }
}

export function getTestDb(): Kysely<TestDatabase> {
  if (!db) {
    throw new Error('Test database not initialized. Call setupTestContainer first.');
  }
  return db;
}

export function getTestContainer(): StartedPostgreSqlContainer {
  if (!container) {
    throw new Error('Test container not initialized. Call setupTestContainer first.');
  }
  return container;
}