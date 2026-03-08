import { describe, test, expect, afterEach } from '@jest/globals';
import { cleanupDatabase } from '../../helpers/cleanup';

let sqlCallCount = 0;

const columnRows = [
  {
    column_name: 'id',
    data_type: 'integer',
    character_maximum_length: null,
    is_nullable: 'NO',
    column_default: 'nextval(...)'
  },
  {
    column_name: 'name',
    data_type: 'character varying',
    character_maximum_length: 100,
    is_nullable: 'NO',
    column_default: null
  }
];

const constraintRows = [
  {
    constraint_name: 'users_pkey',
    constraint_type: 'PRIMARY KEY',
    constraint_definition: 'PRIMARY KEY (id)'
  },
  {
    constraint_name: 'users_email_unique',
    constraint_type: 'UNIQUE',
    constraint_definition: 'UNIQUE (email)'
  }
];

const statsRow = {
  schema_name: 'public',
  table_name: 'users',
  row_count: '1000',
  table_size_bytes: '65536',
  table_size_pretty: '64 kB',
  index_size_bytes: '16384',
  index_size_pretty: '16 kB',
  total_size_bytes: '81920',
  total_size_pretty: '80 kB',
  last_vacuum: '2024-01-01 12:00:00',
  last_autovacuum: null,
  last_analyze: '2024-01-01 12:00:00',
  last_autoanalyze: null
};

const mockExecute = jest.fn(() => {
  const call = sqlCallCount++;
  if (call === 0) return Promise.resolve({ rows: columnRows });
  if (call === 1) return Promise.resolve({ rows: constraintRows });
  return Promise.resolve({ rows: [statsRow] });
});

jest.mock('kysely', () => ({
  sql: jest.fn(() => ({
    execute: mockExecute
  })),
  Kysely: jest.fn(),
  PostgresDialect: jest.fn()
}));

jest.mock('../../../src/db', () => ({
  getDb: jest.fn(() => ({})),
  closeDb: jest.fn(() => Promise.resolve())
}));

describe('Describe Table Tool Unit Tests', () => {
  afterEach(async () => {
    await cleanupDatabase();
    jest.clearAllMocks();
    sqlCallCount = 0;
  });

  describe('Input Validation', () => {
    test('should accept valid schema and table input', async () => {
      const { describeTableTool } = await import('../../../src/tools/describe');

      const result = await describeTableTool({
        schema: 'public',
        table: 'users'
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('should handle empty schema or table names', async () => {
      const { describeTableTool } = await import('../../../src/tools/describe');

      const result = await describeTableTool({
        schema: '',
        table: ''
      });

      expect(result).toBeDefined();
    });
  });

  describe('Return Value Structure', () => {
    test('should return columns, constraints, and stats', async () => {
      const { describeTableTool } = await import('../../../src/tools/describe');

      const result = await describeTableTool({
        schema: 'public',
        table: 'users'
      });

      expect(result).not.toHaveProperty('error');
      expect(result.columns).toBeDefined();
      expect(Array.isArray(result.columns)).toBe(true);
      expect(result.columns!.length).toBe(2);

      expect(result.constraints).toBeDefined();
      expect(Array.isArray(result.constraints)).toBe(true);
      expect(result.constraints!.length).toBe(2);

      expect(result.stats).toBeDefined();
      expect(result.stats!.table_name).toBe('users');
      expect(typeof result.stats!.row_count).toBe('number');
      expect(typeof result.stats!.table_size_bytes).toBe('number');
      expect(typeof result.stats!.index_size_bytes).toBe('number');
      expect(typeof result.stats!.total_size_bytes).toBe('number');
    });

    test('should return column objects with correct structure', async () => {
      const { describeTableTool } = await import('../../../src/tools/describe');

      const result = await describeTableTool({
        schema: 'public',
        table: 'users'
      });

      expect(result.columns).toBeDefined();
      expect(result.columns!.length).toBeGreaterThan(0);

      const firstColumn = result.columns![0];
      expect(firstColumn).toHaveProperty('column_name');
      expect(firstColumn).toHaveProperty('data_type');
      expect(firstColumn).toHaveProperty('character_maximum_length');
      expect(firstColumn).toHaveProperty('is_nullable');
      expect(firstColumn).toHaveProperty('column_default');
    });

    test('should return constraint objects with correct structure', async () => {
      const { describeTableTool } = await import('../../../src/tools/describe');

      const result = await describeTableTool({
        schema: 'public',
        table: 'users'
      });

      expect(result.constraints).toBeDefined();
      expect(result.constraints!.length).toBeGreaterThan(0);

      const firstConstraint = result.constraints![0];
      expect(firstConstraint).toHaveProperty('constraint_name');
      expect(firstConstraint).toHaveProperty('constraint_type');
      expect(firstConstraint).toHaveProperty('constraint_definition');
    });

    test('should handle stats query failure gracefully', async () => {
      mockExecute.mockImplementation((() => {
        const call = sqlCallCount++;
        if (call === 0) return Promise.resolve({ rows: columnRows });
        if (call === 1) return Promise.resolve({ rows: constraintRows });
        return Promise.reject(new Error('Stats query failed'));
      }) as any);

      const { describeTableTool } = await import('../../../src/tools/describe');

      const result = await describeTableTool({
        schema: 'public',
        table: 'users'
      });

      expect(result).not.toHaveProperty('error');
      expect(result.columns).toBeDefined();
      expect(result.columns!.length).toBe(2);
      expect(result.constraints).toBeDefined();
      expect(result.constraints!.length).toBe(2);
      expect(result.stats).toBeNull();
    });
  });

  describe('Error Handling', () => {
    test('should return error object for failed queries', async () => {
      const { sql } = await import('kysely');
      const mockSql = sql as jest.MockedFunction<typeof sql>;

      mockSql.mockImplementationOnce(() => ({
        execute: jest.fn(() => Promise.reject(new Error('Table not found')))
      } as any));

      const { describeTableTool } = await import('../../../src/tools/describe');

      const result = await describeTableTool({
        schema: 'public',
        table: 'nonexistent'
      });

      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
      expect(result.columns).toBeUndefined();
    });
  });
});
