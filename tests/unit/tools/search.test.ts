import { describe, test, expect, afterEach, beforeEach } from '@jest/globals';
import { cleanupDatabase } from '../../helpers/cleanup';

jest.mock('kysely', () => ({
  sql: jest.fn(() => ({
    execute: jest.fn(() => Promise.resolve({
      rows: []
    }))
  })),
  Kysely: jest.fn(),
  PostgresDialect: jest.fn()
}));

jest.mock('../../../src/db', () => ({
  getDb: jest.fn(() => ({})),
  closeDb: jest.fn(() => Promise.resolve())
}));

describe('Search Objects Tool Unit Tests', () => {
  afterEach(async () => {
    await cleanupDatabase();
    jest.clearAllMocks();
  });

  describe('Search with default options', () => {
    beforeEach(() => {
      const { sql } = require('kysely');
      const mockSql = sql as jest.MockedFunction<typeof sql>;
      mockSql.mockImplementation(() => ({
        execute: jest.fn(() => Promise.resolve({
          rows: [
            { object_type: 'table', schema_name: 'public', table_name: null, object_name: 'users', details: 'BASE TABLE' },
          ]
        }))
      }));
    });

    test('should return results for a pattern', async () => {
      const { searchObjectsTool } = await import('../../../src/tools/search');

      const result = await searchObjectsTool({ pattern: 'user' });

      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('total_matches');
      expect(result).not.toHaveProperty('error');
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.results!.length).toBeGreaterThan(0);
      expect(result.results![0].object_name).toBe('users');
    });
  });

  describe('Filter by object_types', () => {
    beforeEach(() => {
      const { sql } = require('kysely');
      const mockSql = sql as jest.MockedFunction<typeof sql>;
      let callCount = 0;
      mockSql.mockImplementation(() => ({
        execute: jest.fn(() => Promise.resolve({
          rows: [
            { object_type: 'table', schema_name: 'public', table_name: null, object_name: 'accounts', details: 'BASE TABLE' },
          ]
        }))
      }));
    });

    test('should only query requested object types', async () => {
      const { sql } = require('kysely');
      const mockSql = sql as jest.MockedFunction<typeof sql>;

      const { searchObjectsTool } = await import('../../../src/tools/search');

      const result = await searchObjectsTool({ pattern: 'acc', object_types: ['table'] });

      expect(result.results).toBeDefined();
      expect(mockSql).toHaveBeenCalledTimes(1);
    });

    test('should query all types when object_types not provided', async () => {
      const { sql } = require('kysely');
      const mockSql = sql as jest.MockedFunction<typeof sql>;

      const { searchObjectsTool } = await import('../../../src/tools/search');

      await searchObjectsTool({ pattern: 'test' });

      expect(mockSql).toHaveBeenCalledTimes(6);
    });
  });

  describe('Limit parameter', () => {
    beforeEach(() => {
      const { sql } = require('kysely');
      const mockSql = sql as jest.MockedFunction<typeof sql>;
      const manyRows = Array.from({ length: 10 }, (_, i) => ({
        object_type: 'table',
        schema_name: 'public',
        table_name: null,
        object_name: `table_${i}`,
        details: 'BASE TABLE',
      }));
      mockSql.mockImplementation(() => ({
        execute: jest.fn(() => Promise.resolve({ rows: manyRows }))
      }));
    });

    test('should respect limit and set truncated flag', async () => {
      const { searchObjectsTool } = await import('../../../src/tools/search');

      const result = await searchObjectsTool({ pattern: 'table', object_types: ['table'], limit: 3 });

      expect(result.results!.length).toBe(3);
      expect(result.truncated).toBe(true);
      expect(result.total_matches).toBe(10);
    });

    test('should not truncate when results fit within limit', async () => {
      const { searchObjectsTool } = await import('../../../src/tools/search');

      const result = await searchObjectsTool({ pattern: 'table', object_types: ['table'], limit: 100 });

      expect(result.results!.length).toBe(10);
      expect(result.truncated).toBe(false);
    });
  });

  describe('Input Validation', () => {
    test('should reject empty pattern', async () => {
      const { searchObjectsTool } = await import('../../../src/tools/search');

      const result = await searchObjectsTool({ pattern: '' });

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Input validation failed');
    });

    test('should reject missing pattern', async () => {
      const { searchObjectsTool } = await import('../../../src/tools/search');

      const result = await searchObjectsTool({});

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Input validation failed');
    });
  });

  describe('Error Handling', () => {
    test('should return error object for failed queries', async () => {
      const { sql } = await import('kysely');
      const mockSql = sql as jest.MockedFunction<typeof sql>;

      mockSql.mockImplementation(() => ({
        execute: jest.fn(() => Promise.reject(new Error('Database error')))
      } as any));

      const { searchObjectsTool } = await import('../../../src/tools/search');

      const result = await searchObjectsTool({ pattern: 'test', object_types: ['table'] });

      expect(result.error).toBeDefined();
      expect(result.error).toBe('Database error');
      expect(result.results).toBeUndefined();
    });

    test('should handle non-Error exceptions', async () => {
      const { sql } = await import('kysely');
      const mockSql = sql as jest.MockedFunction<typeof sql>;

      mockSql.mockImplementation(() => ({
        execute: jest.fn(() => Promise.reject('string error'))
      } as any));

      const { searchObjectsTool } = await import('../../../src/tools/search');

      const result = await searchObjectsTool({ pattern: 'test', object_types: ['table'] });

      expect(result.error).toBe('Unknown error occurred');
    });
  });
});
