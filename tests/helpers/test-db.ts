/**
 * Database testing utilities for creating isolated test environments
 */

import { 
  setupTestContainer, 
  teardownTestContainer, 
  isDockerAvailable 
} from '../setup/testcontainer';

export interface TestEnvironment {
  connectionInfo: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  };
  cleanup: () => void;
  getTools: () => Promise<{
    queryTool: any;
    listObjectsTool: any;
    describeTableTool: any;
    closeDb: any;
  }>;
}

/**
 * Creates an isolated test environment with testcontainers
 */
export async function createTestEnvironment(): Promise<TestEnvironment> {
  const dockerAvailable = await isDockerAvailable();
  
  if (!dockerAvailable) {
    throw new Error('Docker is required for integration tests');
  }

  const { container, db, connectionInfo } = await setupTestContainer();
  
  // Store original environment
  const originalEnv = { ...process.env };
  
  // Override environment variables for this test
  process.env.DB_HOST = connectionInfo.host;
  process.env.DB_PORT = connectionInfo.port.toString();
  process.env.DB_USER = connectionInfo.username;
  process.env.DB_PASSWORD = connectionInfo.password;
  process.env.DB_NAME = connectionInfo.database;
  process.env.DB_SSL = 'false';

  // Clear module cache to force fresh imports with new env vars
  const moduleKeys = [
    require.resolve('../../src/db'),
    require.resolve('../../src/tools/query'),
    require.resolve('../../src/tools/list'),
    require.resolve('../../src/tools/describe')
  ];
  
  moduleKeys.forEach(key => {
    delete require.cache[key];
  });

  const cleanup = () => {
    // Restore original environment
    process.env = originalEnv;
    
    // Clear module cache again to restore original modules
    moduleKeys.forEach(key => {
      delete require.cache[key];
    });
  };

  const getTools = async () => {
    const { queryTool } = await import('../../src/tools/query');
    const { listObjectsTool } = await import('../../src/tools/list');
    const { describeTableTool } = await import('../../src/tools/describe');
    const { closeDb } = await import('../../src/db');

    return { queryTool, listObjectsTool, describeTableTool, closeDb };
  };

  return {
    connectionInfo,
    cleanup,
    getTools
  };
}

/**
 * Safely runs a test with Docker, skipping if not available
 */
export async function withDocker<T>(
  testFn: () => Promise<T>
): Promise<T | undefined> {
  const dockerAvailable = await isDockerAvailable();
  
  if (!dockerAvailable) {
    // Skip test silently
    return undefined;
  }
  
  return await testFn();
}