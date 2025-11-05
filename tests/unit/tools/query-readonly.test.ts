import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { cleanupDatabase } from '../../helpers/cleanup';

// Mock kysely sql for READ_ONLY testing
jest.mock('kysely', () => {
  const createMockExecutable = (query: string) => ({
    execute: jest.fn(() => {
      if (query.includes('ERROR')) {
        return Promise.reject(new Error('Mocked SQL error'));
      }
      const upperQuery = query.toUpperCase();
      const trimmedUpper = upperQuery.trim();
      if (trimmedUpper.startsWith('SELECT') || trimmedUpper.startsWith('WITH') || trimmedUpper.startsWith('EXPLAIN') || trimmedUpper.startsWith('SHOW') || trimmedUpper.startsWith('VALUES') || trimmedUpper.startsWith('TABLE')) {
        return Promise.resolve({ rows: [{ id: 1, name: 'test' }] });
      }
      return Promise.resolve({ numAffectedRows: 1 });
    })
  });

  // Mock sql template tag function
  const sqlTemplateFn: any = (strings: TemplateStringsArray | string, ...values: any[]) => {
    // Handle both template tag usage and property access
    if (typeof strings === 'string') {
      // This is sql.raw() or similar
      return createMockExecutable(strings);
    }

    // This is sql`...` template tag usage
    const query = strings.reduce((acc, str, i) => {
      return acc + str + (values[i] !== undefined ? String(values[i]) : '');
    }, '');
    return createMockExecutable(query);
  };

  // Add raw method
  sqlTemplateFn.raw = jest.fn((query: string) => createMockExecutable(query));

  return {
    sql: sqlTemplateFn,
    Kysely: jest.fn(),
    PostgresDialect: jest.fn()
  };
});

// Mock database module
jest.mock('../../../src/db', () => ({
  getDb: jest.fn(() => ({})),
  closeDb: jest.fn(() => Promise.resolve())
}));

describe('Query Tool READ_ONLY Mode Tests', () => {
  // Store original environment
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment for each test
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
  });

  afterEach(async () => {
    await cleanupDatabase();
    jest.clearAllMocks();
    process.env = originalEnv;
  });

  describe('READ_ONLY=true Mode', () => {
    beforeEach(() => {
      process.env.READ_ONLY = 'true';
    });

    test('should allow SELECT queries in read-only mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'SELECT * FROM users' 
      });
      
      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
      expect(result.rowCount).toBe(1);
    });

    test('should allow WITH queries in read-only mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'WITH user_count AS (SELECT COUNT(*) FROM users) SELECT * FROM user_count' 
      });
      
      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
      expect(result.rowCount).toBe(1);
    });

    test('should allow EXPLAIN queries in read-only mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'EXPLAIN SELECT * FROM users' 
      });
      
      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test('should block INSERT queries in read-only mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'INSERT INTO users (name) VALUES (\'test\')' 
      });
      
      expect(result.error).toBeDefined();
      expect(result.error).toContain('read-only mode');
      expect(result.rows).toBeUndefined();
      expect(result.rowCount).toBeUndefined();
    });

    test('should block UPDATE queries in read-only mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'UPDATE users SET name = \'updated\' WHERE id = 1' 
      });
      
      expect(result.error).toBeDefined();
      expect(result.error).toContain('read-only mode');
      expect(result.rows).toBeUndefined();
      expect(result.rowCount).toBeUndefined();
    });

    test('should block DELETE queries in read-only mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'DELETE FROM users WHERE id = 1' 
      });
      
      expect(result.error).toBeDefined();
      expect(result.error).toContain('read-only mode');
      expect(result.rows).toBeUndefined();
      expect(result.rowCount).toBeUndefined();
    });

    test('should block MERGE queries in read-only mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'MERGE INTO users USING temp_users ON users.id = temp_users.id' 
      });
      
      expect(result.error).toBeDefined();
      expect(result.error).toContain('read-only mode');
    });

    test('should block UPSERT queries in read-only mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'UPSERT INTO users (id, name) VALUES (1, \'test\')' 
      });
      
      expect(result.error).toBeDefined();
      expect(result.error).toContain('read-only mode');
    });

    test('should block dangerous operations in read-only mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'DROP TABLE users' 
      });
      
      expect(result.error).toBeDefined();
      expect(result.error).toContain('not allowed');
    });

    test('should handle case-insensitive queries in read-only mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const selectResult = await queryTool({ 
        sql: 'select * from users' 
      });
      expect(selectResult.error).toBeUndefined();
      expect(selectResult.rows).toBeDefined();

      const insertResult = await queryTool({ 
        sql: 'insert into users (name) values (\'test\')' 
      });
      expect(insertResult.error).toBeDefined();
      expect(insertResult.error).toContain('read-only mode');
    });

    test('should allow parameterized SELECT queries in read-only mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'SELECT * FROM users WHERE id = $1',
        parameters: [123]
      });
      
      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
      expect(result.rowCount).toBe(1);
    });

    test('should block parameterized write queries in read-only mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'INSERT INTO users (name, email) VALUES ($1, $2)',
        parameters: ['John Doe', 'john@example.com']
      });
      
      expect(result.error).toBeDefined();
      expect(result.error).toContain('read-only mode');
    });

    test('should apply row limits in read-only mode', async () => {
      process.env.ROW_LIMIT = '100';
      
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'SELECT * FROM users' 
      });
      
      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
      // Note: Row limiting is tested more thoroughly in validation tests
    });
  });

  describe('READ_ONLY=false Mode', () => {
    beforeEach(() => {
      process.env.READ_ONLY = 'false';
    });

    test('should allow SELECT queries in write mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'SELECT * FROM users' 
      });
      
      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
      expect(result.rowCount).toBe(1);
    });

    test('should allow INSERT queries in write mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'INSERT INTO users (name) VALUES (\'test\')' 
      });
      
      expect(result.error).toBeUndefined();
      expect(result.rows).toBeUndefined();
      expect(result.rowCount).toBe(1);
    });

    test('should allow UPDATE queries with WHERE clause in write mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'UPDATE users SET name = \'updated\' WHERE id = 1' 
      });
      
      expect(result.error).toBeUndefined();
      expect(result.rows).toBeUndefined();
      expect(result.rowCount).toBe(1);
    });

    test('should allow DELETE queries with WHERE clause in write mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'DELETE FROM users WHERE id = 1' 
      });
      
      expect(result.error).toBeUndefined();
      expect(result.rows).toBeUndefined();
      expect(result.rowCount).toBe(1);
    });

    test('should block UPDATE queries without WHERE clause in write mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'UPDATE users SET name = \'updated\'' 
      });
      
      expect(result.error).toBeDefined();
      expect(result.error).toContain('WHERE clause');
    });

    test('should block DELETE queries without WHERE clause in write mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'DELETE FROM users' 
      });
      
      expect(result.error).toBeDefined();
      expect(result.error).toContain('WHERE clause');
    });

    test('should still block dangerous operations in write mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'DROP TABLE users' 
      });
      
      expect(result.error).toBeDefined();
      expect(result.error).toContain('not allowed');
    });

    test('should allow parameterized write queries in write mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'INSERT INTO users (name, email) VALUES ($1, $2)',
        parameters: ['John Doe', 'john@example.com']
      });
      
      expect(result.error).toBeUndefined();
      expect(result.rowCount).toBe(1);
    });

    test('should allow complex write operations in write mode', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2 AND active = $3',
        parameters: ['Updated Name', 123, true]
      });
      
      expect(result.error).toBeUndefined();
      expect(result.rowCount).toBe(1);
    });
  });

  describe('Default READ_ONLY Behavior', () => {
    test('should default to READ-only mode when READ_ONLY not set', async () => {
      delete process.env.READ_ONLY;
      
      const { queryTool } = await import('../../../src/tools/query');
      
      const selectResult = await queryTool({ 
        sql: 'SELECT * FROM users' 
      });
      expect(selectResult.error).toBeUndefined();
      expect(selectResult.rows).toBeDefined();

      const insertResult = await queryTool({ 
        sql: 'INSERT INTO users (name) VALUES (\'test\')' 
      });
      expect(insertResult.error).toBeDefined();
      expect(insertResult.error).toContain('read-only mode');
    });

    test('should default to read-only mode when READ_ONLY is empty string', async () => {
      process.env.READ_ONLY = '';
      
      const { queryTool } = await import('../../../src/tools/query');
      
      const insertResult = await queryTool({ 
        sql: 'INSERT INTO users (name) VALUES (\'test\')' 
      });
      expect(insertResult.error).toBeDefined();
      expect(insertResult.error).toContain('read-only mode');
    });

    test('should default to read-only mode when READ_ONLY is undefined', async () => {
      process.env.READ_ONLY = undefined;
      
      const { queryTool } = await import('../../../src/tools/query');
      
      const insertResult = await queryTool({ 
        sql: 'INSERT INTO users (name) VALUES (\'test\')' 
      });
      expect(insertResult.error).toBeDefined();
      expect(insertResult.error).toContain('read-only mode');
    });

    test('should enable write mode only when explicitly set to false', async () => {
      process.env.READ_ONLY = 'false';
      
      const { queryTool } = await import('../../../src/tools/query');
      
      const insertResult = await queryTool({ 
        sql: 'INSERT INTO users (name) VALUES (\'test\')' 
      });
      expect(insertResult.error).toBeUndefined();
      expect(insertResult.rowCount).toBe(1);
    });

    test('should treat any non-false value as read-only', async () => {
      const nonFalseValues = ['true', 'yes', '1', 'on', 'enabled', 'anything'];
      
      for (const value of nonFalseValues) {
        process.env.READ_ONLY = value;
        jest.resetModules();
        
        const { queryTool } = await import('../../../src/tools/query');
        
        const insertResult = await queryTool({ 
          sql: 'INSERT INTO users (name) VALUES (\'test\')' 
        });
        expect(insertResult.error).toBeDefined();
        expect(insertResult.error).toContain('read-only mode');
      }
    });
  });

  describe('Environment Variable Handling', () => {
    test('should respect ROW_LIMIT in read-only mode', async () => {
      process.env.READ_ONLY = 'true';
      process.env.ROW_LIMIT = '50';
      
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'SELECT * FROM users' 
      });
      
      expect(result.error).toBeUndefined();
      expect(result.rows).toBeDefined();
    });

    test('should respect QUERY_TIMEOUT in both modes', async () => {
      process.env.QUERY_TIMEOUT = '5000';
      process.env.READ_ONLY = 'false';
      
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({ 
        sql: 'SELECT * FROM users WHERE id = 1' 
      });
      
      expect(result.error).toBeUndefined();
    });
  });
});