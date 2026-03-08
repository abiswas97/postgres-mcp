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

const baseMockRows = [
  { pid: 1, user: 'app', database: 'mydb', application_name: 'web', client_addr: '10.0.0.1', state: 'active', state_changed_at: '2026-01-01T00:00:00Z', duration_seconds: 5, wait_event_type: null, wait_event: null, query: 'SELECT 1' },
  { pid: 2, user: 'app', database: 'mydb', application_name: 'web', client_addr: '10.0.0.2', state: 'idle', state_changed_at: '2026-01-01T00:00:00Z', duration_seconds: 60, wait_event_type: null, wait_event: null, query: 'SELECT 2' },
  { pid: 3, user: 'admin', database: 'mydb', application_name: 'worker', client_addr: '10.0.0.3', state: 'idle in transaction', state_changed_at: '2026-01-01T00:00:00Z', duration_seconds: 400, wait_event_type: null, wait_event: null, query: 'UPDATE foo SET bar = 1' },
  { pid: 4, user: 'app', database: 'mydb', application_name: 'web', client_addr: '10.0.0.4', state: 'active', state_changed_at: '2026-01-01T00:00:00Z', duration_seconds: 10, wait_event_type: 'Lock', wait_event: 'relation', query: 'DELETE FROM foo' },
];

function setupMock(maxConnections: number, rows: any[]) {
  const { sql } = require('kysely');
  const mockSql = sql as jest.MockedFunction<typeof sql>;
  let callCount = 0;
  mockSql.mockImplementation(() => ({
    execute: jest.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ rows: [{ max_connections: maxConnections }] });
      }
      return Promise.resolve({ rows });
    })
  }));
}

describe('Get Connections Tool Unit Tests', () => {
  afterEach(async () => {
    await cleanupDatabase();
    jest.clearAllMocks();
  });

  describe('Summary with correct state counts', () => {
    beforeEach(() => setupMock(100, baseMockRows));

    test('should return summary with correct by_state counts', async () => {
      const { getConnectionsTool } = await import('../../../src/tools/connections');
      const result = await getConnectionsTool({});

      expect(result.error).toBeUndefined();
      expect(result.summary).toBeDefined();
      expect(result.summary!.total).toBe(4);
      expect(result.summary!.max_connections).toBe(100);
      expect(result.summary!.utilization_pct).toBe(4);
      expect(result.summary!.by_state.active).toBe(1);
      expect(result.summary!.by_state.idle).toBe(1);
      expect(result.summary!.by_state.idle_in_transaction).toBe(1);
      expect(result.summary!.by_state.waiting).toBe(1);
      expect(result.summary!.by_state.other).toBe(0);
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('Warnings', () => {
    test('should warn about idle-in-transaction > 5 minutes', async () => {
      setupMock(100, baseMockRows);
      const { getConnectionsTool } = await import('../../../src/tools/connections');
      const result = await getConnectionsTool({});

      expect(result.warnings).toBeDefined();
      expect(result.warnings).toContainEqual(
        expect.stringContaining('idle-in-transaction for > 5 minutes')
      );
    });

    test('should warn about high utilization', async () => {
      const manyRows = Array.from({ length: 80 }, (_, i) => ({
        pid: i, user: 'app', database: 'mydb', application_name: 'web',
        client_addr: '10.0.0.1', state: 'active', state_changed_at: '2026-01-01T00:00:00Z',
        duration_seconds: 5, wait_event_type: null, wait_event: null, query: 'SELECT 1'
      }));
      setupMock(100, manyRows);
      const { getConnectionsTool } = await import('../../../src/tools/connections');
      const result = await getConnectionsTool({});

      expect(result.warnings).toContainEqual(
        expect.stringContaining('Connection utilization at 80%')
      );
    });

    test('should warn about waiting connections', async () => {
      const waitingRows = [
        { pid: 1, user: 'app', database: 'mydb', application_name: 'web', client_addr: '10.0.0.1', state: 'active', state_changed_at: null, duration_seconds: 5, wait_event_type: 'Lock', wait_event: 'relation', query: 'SELECT 1' },
      ];
      setupMock(100, waitingRows);
      const { getConnectionsTool } = await import('../../../src/tools/connections');
      const result = await getConnectionsTool({});

      expect(result.warnings).toContainEqual(
        expect.stringContaining('waiting on locks')
      );
    });
  });

  describe('Query field visibility', () => {
    beforeEach(() => setupMock(100, baseMockRows));

    test('should omit query field when include_queries is false', async () => {
      const { getConnectionsTool } = await import('../../../src/tools/connections');
      const result = await getConnectionsTool({ include_queries: false });

      expect(result.connections).toBeDefined();
      for (const conn of result.connections!) {
        expect(conn).not.toHaveProperty('query');
      }
    });

    test('should omit query field by default', async () => {
      const { getConnectionsTool } = await import('../../../src/tools/connections');
      const result = await getConnectionsTool({});

      expect(result.connections).toBeDefined();
      for (const conn of result.connections!) {
        expect(conn).not.toHaveProperty('query');
      }
    });

    test('should include query field when include_queries is true', async () => {
      const { getConnectionsTool } = await import('../../../src/tools/connections');
      const result = await getConnectionsTool({ include_queries: true });

      expect(result.connections).toBeDefined();
      for (const conn of result.connections!) {
        expect(conn).toHaveProperty('query');
      }
    });
  });

  describe('Error Handling', () => {
    test('should return error for database failure', async () => {
      const { sql } = require('kysely');
      const mockSql = sql as jest.MockedFunction<typeof sql>;
      mockSql.mockImplementation(() => ({
        execute: jest.fn(() => Promise.reject(new Error('Connection refused')))
      }));

      const { getConnectionsTool } = await import('../../../src/tools/connections');
      const result = await getConnectionsTool({});

      expect(result.error).toBe('Connection refused');
      expect(result.summary).toBeUndefined();
    });

    test('should handle non-Error exceptions', async () => {
      const { sql } = require('kysely');
      const mockSql = sql as jest.MockedFunction<typeof sql>;
      mockSql.mockImplementation(() => ({
        execute: jest.fn(() => Promise.reject('string error'))
      }));

      const { getConnectionsTool } = await import('../../../src/tools/connections');
      const result = await getConnectionsTool({});

      expect(result.error).toBe('Unknown error occurred');
    });
  });
});
