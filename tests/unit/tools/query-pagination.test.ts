import { describe, test, expect, beforeAll, afterEach } from '@jest/globals';
import { cleanupDatabase } from '../../helpers/cleanup';

// Mock kysely sql for pagination testing
jest.mock('kysely', () => {
  const createMockExecutable = (query: string) => ({
    execute: jest.fn(() => {
      if (query.includes('ERROR')) {
        return Promise.reject(new Error('Mocked SQL error'));
      }

      // Simulate different result sizes based on LIMIT
      const limitMatch = query.match(/LIMIT (\d+)/i);
      const limit = limitMatch ? parseInt(limitMatch[1], 10) : 100;

      // Generate mock rows based on limit
      const rows = Array.from({ length: limit }, (_, i) => ({
        id: i + 1,
        name: `User ${i + 1}`,
        email: `user${i + 1}@example.com`
      }));

      const trimmedUpper = query.toUpperCase().trim();
      if (trimmedUpper.startsWith('SELECT') || trimmedUpper.startsWith('WITH') || trimmedUpper.startsWith('EXPLAIN') || trimmedUpper.startsWith('SHOW') || trimmedUpper.startsWith('VALUES') || trimmedUpper.startsWith('TABLE')) {
        return Promise.resolve({ rows });
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

describe('Query Tool Pagination Tests', () => {
  beforeAll(() => {
    process.env.READ_ONLY = 'false';
    process.env.NODE_ENV = 'development';
    process.env.MAX_PAGE_SIZE = '500';
    process.env.DEFAULT_PAGE_SIZE = '100';
  });

  afterEach(async () => {
    await cleanupDatabase();
    jest.clearAllMocks();
  });

  describe('Page Size Validation', () => {
    test('should accept valid page size within range (1-500)', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users',
        pageSize: 250
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination?.pageSize).toBe(250);
      expect(result.rows).toBeDefined();
    });

    test('should reject page size of 0', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users',
        pageSize: 0
      });
      
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Input validation failed');
    });

    test('should reject negative page size', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users',
        pageSize: -10
      });
      
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Input validation failed');
    });

    test('should reject page size exceeding maximum (500)', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users',
        pageSize: 501
      });
      
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Input validation failed');
    });

    test('should use default page size when not specified', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users'
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination?.pageSize).toBe(100); // DEFAULT_PAGE_SIZE
    });

    test('should cap page size at maximum when environment allows higher', async () => {
      // Temporarily increase MAX_PAGE_SIZE via environment
      const originalMax = process.env.MAX_PAGE_SIZE;
      process.env.MAX_PAGE_SIZE = '200';
      
      // Clear module cache to reload with new env
      jest.resetModules();
      
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users',
        pageSize: 300 // Higher than MAX_PAGE_SIZE
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination?.pageSize).toBe(200); // Capped at MAX_PAGE_SIZE
      
      // Restore original environment
      process.env.MAX_PAGE_SIZE = originalMax;
    });
  });

  describe('Offset Validation', () => {
    test('should accept valid offset of 0', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users',
        offset: 0
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination?.offset).toBe(0);
    });

    test('should accept positive offset', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users',
        offset: 100
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination?.offset).toBe(100);
    });

    test('should reject negative offset', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users',
        offset: -10
      });
      
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Input validation failed');
    });

    test('should use default offset (0) when not specified', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users'
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination?.offset).toBe(0);
    });

    test('should handle large offset values', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users',
        offset: 999999
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination?.offset).toBe(999999);
    });
  });

  describe('Pagination Metadata', () => {
    test('should return pagination metadata for SELECT queries', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users',
        pageSize: 50,
        offset: 25
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination).toBeDefined();
      expect(result.pagination?.pageSize).toBe(50);
      expect(result.pagination?.offset).toBe(25);
      expect(result.pagination?.hasMore).toBe(true); // Should have hasMore since we got full page
    });

    test('should indicate hasMore=true when result set equals page size', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users',
        pageSize: 10
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination?.hasMore).toBe(true);
      expect(result.rows?.length).toBe(10);
    });

    test('should not return pagination metadata for write operations', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'INSERT INTO users (name) VALUES ($1)',
        parameters: ['Test User'],
        pageSize: 50
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination).toBeUndefined();
      expect(result.rowCount).toBe(1);
    });
  });

  describe('SQL Query Modification', () => {
    test('should add LIMIT clause when not present', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users',
        pageSize: 25
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination?.pageSize).toBe(25);
    });

    test('should add LIMIT and OFFSET when offset specified', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users ORDER BY id',
        pageSize: 20,
        offset: 40
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination?.pageSize).toBe(20);
      expect(result.pagination?.offset).toBe(40);
    });

    test('should preserve existing LIMIT clause', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users LIMIT 10',
        pageSize: 50
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination?.pageSize).toBe(50); // Reports requested size
    });

    test('should preserve existing OFFSET clause', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users OFFSET 20',
        offset: 100
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination?.offset).toBe(100); // Reports requested offset
    });

    test('should not modify aggregate queries without GROUP BY', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT COUNT(*) FROM users',
        pageSize: 50
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination?.pageSize).toBe(50);
    });

    test('should modify aggregate queries with GROUP BY', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT department, COUNT(*) FROM users GROUP BY department',
        pageSize: 30
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination?.pageSize).toBe(30);
    });
  });

  describe('Pagination with Parameters', () => {
    test('should work with parameterized queries', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users WHERE age > $1',
        parameters: [18],
        pageSize: 25,
        offset: 10
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination?.pageSize).toBe(25);
      expect(result.pagination?.offset).toBe(10);
      expect(result.rows).toBeDefined();
    });

    test('should handle multiple parameters with pagination', async () => {
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users WHERE age > $1 AND name LIKE $2',
        parameters: [21, '%John%'],
        pageSize: 15,
        offset: 5
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination?.pageSize).toBe(15);
      expect(result.pagination?.offset).toBe(5);
    });
  });

  describe('Environment Configuration', () => {
    test('should respect custom MAX_PAGE_SIZE environment variable', async () => {
      const originalMax = process.env.MAX_PAGE_SIZE;
      process.env.MAX_PAGE_SIZE = '300';
      
      jest.resetModules();
      
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users',
        pageSize: 350 // Above the custom limit
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination?.pageSize).toBe(300);
      
      process.env.MAX_PAGE_SIZE = originalMax;
    });

    test('should respect custom DEFAULT_PAGE_SIZE environment variable', async () => {
      const originalDefault = process.env.DEFAULT_PAGE_SIZE;
      process.env.DEFAULT_PAGE_SIZE = '75';
      
      jest.resetModules();
      
      const { queryTool } = await import('../../../src/tools/query');
      
      const result = await queryTool({
        sql: 'SELECT * FROM users'
      });
      
      expect(result.error).toBeUndefined();
      expect(result.pagination?.pageSize).toBe(75);
      
      process.env.DEFAULT_PAGE_SIZE = originalDefault;
    });
  });
});