import { describe, test, expect, afterEach } from '@jest/globals';
import { cleanupDatabase } from '../../helpers/cleanup';

jest.mock('kysely', () => ({
  sql: jest.fn(() => ({
    execute: jest.fn(() => Promise.resolve({ rows: [] }))
  })),
  Kysely: jest.fn(),
  PostgresDialect: jest.fn()
}));

jest.mock('../../../src/db', () => ({
  getDb: jest.fn(() => ({})),
  closeDb: jest.fn(() => Promise.resolve())
}));

function healthyDefaults(): any[] {
  return [
    { rows: [{ ratio: 99.8 }] },
    { rows: [{ max_connections: 100 }] },
    { rows: [{ total: 5, active: 2, idle: 2, idle_in_transaction: 1 }] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [{ size_bytes: 1048576, size_pretty: '1 MB' }] },
  ];
}

function setupMock(responses: any[]) {
  const { sql } = require('kysely');
  const mockSql = sql as jest.MockedFunction<typeof sql>;
  let callCount = 0;
  mockSql.mockImplementation(() => ({
    execute: jest.fn(() => {
      const resp = responses[callCount] ?? { rows: [] };
      callCount++;
      if (resp instanceof Error) return Promise.reject(resp);
      return Promise.resolve(resp);
    })
  }));
}

describe('Diagnose Database Tool Unit Tests', () => {
  afterEach(async () => {
    await cleanupDatabase();
    jest.clearAllMocks();
  });

  test('returns healthy status when all metrics are good', async () => {
    setupMock(healthyDefaults());
    const { diagnoseDatabaseTool } = await import('../../../src/tools/diagnostics');
    const result = await diagnoseDatabaseTool({});

    expect(result.error).toBeUndefined();
    expect(result.status).toBe('healthy');
    expect(result.summary).toBe('healthy: all checks passed');
    expect(result.checks).toBeDefined();
    expect(result.checks!.cache_hit_ratio.status).toBe('healthy');
    expect(result.checks!.connection_saturation.status).toBe('healthy');
    expect(result.checks!.database_size.size_pretty).toBe('1 MB');
    expect(result.timestamp).toBeDefined();
  });

  test('returns warning for low cache hit ratio (97%)', async () => {
    const responses = healthyDefaults();
    responses[0] = { rows: [{ ratio: 97 }] };
    setupMock(responses);
    const { diagnoseDatabaseTool } = await import('../../../src/tools/diagnostics');
    const result = await diagnoseDatabaseTool({});

    expect(result.status).toBe('warning');
    expect(result.checks!.cache_hit_ratio.status).toBe('warning');
    expect(result.checks!.cache_hit_ratio.value).toBe(97);
    expect(result.summary).toContain('low cache hit ratio (97%)');
  });

  test('returns critical for very low cache hit ratio (90%)', async () => {
    const responses = healthyDefaults();
    responses[0] = { rows: [{ ratio: 90 }] };
    setupMock(responses);
    const { diagnoseDatabaseTool } = await import('../../../src/tools/diagnostics');
    const result = await diagnoseDatabaseTool({});

    expect(result.status).toBe('critical');
    expect(result.checks!.cache_hit_ratio.status).toBe('critical');
  });

  test('detects unused indexes', async () => {
    const responses = healthyDefaults();
    responses[6] = { rows: [
      { schemaname: 'public', table_name: 'users', index_name: 'idx_unused', size_pretty: '8192 bytes' },
      { schemaname: 'public', table_name: 'posts', index_name: 'idx_old', size_pretty: '16 kB' },
    ] };
    setupMock(responses);
    const { diagnoseDatabaseTool } = await import('../../../src/tools/diagnostics');
    const result = await diagnoseDatabaseTool({});

    expect(result.checks!.unused_indexes.status).toBe('warning');
    expect(result.checks!.unused_indexes.indexes).toHaveLength(2);
    expect(result.summary).toContain('2 unused indexes');
  });

  test('detects high connection utilization', async () => {
    const responses = healthyDefaults();
    responses[1] = { rows: [{ max_connections: 100 }] };
    responses[2] = { rows: [{ total: 85, active: 40, idle: 30, idle_in_transaction: 15 }] };
    setupMock(responses);
    const { diagnoseDatabaseTool } = await import('../../../src/tools/diagnostics');
    const result = await diagnoseDatabaseTool({});

    expect(result.checks!.connection_saturation.status).toBe('warning');
    expect(result.checks!.connection_saturation.utilization_pct).toBe(85);
    expect(result.summary).toContain('connection utilization at 85%');
  });

  test('detects critical connection utilization', async () => {
    const responses = healthyDefaults();
    responses[1] = { rows: [{ max_connections: 100 }] };
    responses[2] = { rows: [{ total: 95, active: 80, idle: 10, idle_in_transaction: 5 }] };
    setupMock(responses);
    const { diagnoseDatabaseTool } = await import('../../../src/tools/diagnostics');
    const result = await diagnoseDatabaseTool({});

    expect(result.checks!.connection_saturation.status).toBe('critical');
    expect(result.status).toBe('critical');
  });

  test('handles individual check failures gracefully', async () => {
    const responses: any[] = [
      new Error('cache stats unavailable'),
      { rows: [{ max_connections: 100 }] },
      { rows: [{ total: 5, active: 2, idle: 2, idle_in_transaction: 1 }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ size_bytes: 1048576, size_pretty: '1 MB' }] },
    ];
    setupMock(responses);
    const { diagnoseDatabaseTool } = await import('../../../src/tools/diagnostics');
    const result = await diagnoseDatabaseTool({});

    expect(result.error).toBeUndefined();
    expect(result.status).toBeDefined();
    expect(result.checks_skipped).toBeDefined();
    expect(result.checks_skipped!.length).toBeGreaterThan(0);
    expect(result.checks_skipped![0]).toContain('cache_hit_ratio');
    expect(result.checks_skipped![0]).toContain('cache stats unavailable');
    expect(result.checks!.connection_saturation).toBeDefined();
  });

  test('returns proper summary string with multiple issues', async () => {
    const responses = healthyDefaults();
    responses[0] = { rows: [{ ratio: 97 }] };
    responses[6] = { rows: [
      { schemaname: 'public', table_name: 'users', index_name: 'idx_unused', size_pretty: '8 kB' },
    ] };
    setupMock(responses);
    const { diagnoseDatabaseTool } = await import('../../../src/tools/diagnostics');
    const result = await diagnoseDatabaseTool({});

    expect(result.status).toBe('warning');
    expect(result.summary).toContain('2 warnings');
    expect(result.summary).toContain('low cache hit ratio');
    expect(result.summary).toContain('unused indexes');
  });

  test('includes timestamp', async () => {
    setupMock(healthyDefaults());
    const { diagnoseDatabaseTool } = await import('../../../src/tools/diagnostics');
    const result = await diagnoseDatabaseTool({});

    expect(result.timestamp).toBeDefined();
    expect(new Date(result.timestamp!).getTime()).not.toBeNaN();
  });

  test('skips long_running_queries when include_queries is false', async () => {
    setupMock(healthyDefaults());
    const { diagnoseDatabaseTool } = await import('../../../src/tools/diagnostics');
    const result = await diagnoseDatabaseTool({ include_queries: false });

    expect(result.checks!.long_running_queries).toBeUndefined();
  });

  test('skips connection_saturation when include_connections is false', async () => {
    setupMock(healthyDefaults());
    const { diagnoseDatabaseTool } = await import('../../../src/tools/diagnostics');
    const result = await diagnoseDatabaseTool({ include_connections: false });

    expect(result.checks!.connection_saturation).toBeUndefined();
  });

  test('returns validation error for invalid input', async () => {
    const { diagnoseDatabaseTool } = await import('../../../src/tools/diagnostics');
    const result = await diagnoseDatabaseTool({ include_queries: 'not_a_boolean' });

    expect(result.error).toBeDefined();
    expect(result.error).toContain('Input validation failed');
  });
});
