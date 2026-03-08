import { describe, test, expect, afterEach } from '@jest/globals';
import { cleanupDatabase } from '../../helpers/cleanup';

const mockSqlRaw = jest.fn(() => ({
  execute: jest.fn(() => Promise.resolve({
    rows: [
      { 'QUERY PLAN': 'Seq Scan on users  (cost=0.00..35.50 rows=2550 width=4)' }
    ]
  }))
}));

jest.mock('kysely', () => ({
  sql: Object.assign(jest.fn(), { raw: mockSqlRaw }),
  Kysely: jest.fn(),
  PostgresDialect: jest.fn()
}));

jest.mock('../../../src/db', () => ({
  getDb: jest.fn(() => ({})),
  closeDb: jest.fn(() => Promise.resolve())
}));

describe('Performance Tools Unit Tests', () => {
  afterEach(async () => {
    await cleanupDatabase();
    jest.clearAllMocks();
  });

  describe('Explain Query Tool', () => {
    describe('Input Validation', () => {
      test('should accept valid SELECT query', async () => {
        const { explainQueryTool } = await import('../../../src/tools/performance');

        const result = await explainQueryTool({ sql: 'SELECT * FROM users' });

        expect(result).toBeDefined();
        expect(typeof result).toBe('object');
      });

      test('should reject INSERT queries', async () => {
        const { explainQueryTool } = await import('../../../src/tools/performance');

        const result = await explainQueryTool({ sql: 'INSERT INTO users (name) VALUES (\'test\')' });

        expect(result.error).toBeDefined();
        expect(result.error).toContain('EXPLAIN is only allowed for SELECT queries');
      });

      test('should reject UPDATE queries', async () => {
        const { explainQueryTool } = await import('../../../src/tools/performance');

        const result = await explainQueryTool({ sql: 'UPDATE users SET name = \'test\'' });

        expect(result.error).toBeDefined();
        expect(result.error).toContain('EXPLAIN is only allowed for SELECT queries');
      });

      test('should reject DELETE queries', async () => {
        const { explainQueryTool } = await import('../../../src/tools/performance');

        const result = await explainQueryTool({ sql: 'DELETE FROM users' });

        expect(result.error).toBeDefined();
        expect(result.error).toContain('EXPLAIN is only allowed for SELECT queries');
      });

      test('should reject DROP queries', async () => {
        const { explainQueryTool } = await import('../../../src/tools/performance');

        const result = await explainQueryTool({ sql: 'DROP TABLE users' });

        expect(result.error).toBeDefined();
        expect(result.error).toContain('EXPLAIN is only allowed for SELECT queries');
      });

      test('should accept WITH queries', async () => {
        const { explainQueryTool } = await import('../../../src/tools/performance');

        const result = await explainQueryTool({ sql: 'WITH cte AS (SELECT * FROM users) SELECT * FROM cte' });

        expect(result).toBeDefined();
        expect(result.plan).toBeDefined();
      });
    });

    describe('Return Value Structure', () => {
      test('should return plan array for valid queries', async () => {
        const { explainQueryTool } = await import('../../../src/tools/performance');

        const result = await explainQueryTool({ sql: 'SELECT * FROM users' });

        expect(result).toHaveProperty('plan');
        expect(result).not.toHaveProperty('error');
        expect(Array.isArray(result.plan)).toBe(true);
      });

      test('should handle analyze option', async () => {
        const { explainQueryTool } = await import('../../../src/tools/performance');

        const result = await explainQueryTool({ sql: 'SELECT * FROM users', analyze: true });

        expect(result).toBeDefined();
        expect(result.plan).toBeDefined();
      });

      test('should handle buffers option', async () => {
        const { explainQueryTool } = await import('../../../src/tools/performance');

        const result = await explainQueryTool({ sql: 'SELECT * FROM users', buffers: true });

        expect(result).toBeDefined();
        expect(result.plan).toBeDefined();
      });

      test('should handle format option', async () => {
        const { explainQueryTool } = await import('../../../src/tools/performance');

        const result = await explainQueryTool({ sql: 'SELECT * FROM users', format: 'json' });

        expect(result).toBeDefined();
        expect(result.plan).toBeDefined();
      });
    });

    describe('Error Handling', () => {
      test('should return error object for failed queries', async () => {
        mockSqlRaw.mockImplementationOnce(() => ({
          execute: jest.fn(() => Promise.reject(new Error('Database error')))
        } as any));

        const { explainQueryTool } = await import('../../../src/tools/performance');

        const result = await explainQueryTool({ sql: 'SELECT * FROM users' });

        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe('string');
        expect(result.plan).toBeUndefined();
      });
    });
  });
});
