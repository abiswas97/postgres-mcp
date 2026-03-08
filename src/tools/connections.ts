import { sql } from "kysely";
import { getDb } from "../db.js";
import { GetConnectionsInputSchema, validateInput } from "../validation.js";

export interface ConnectionInfo {
  pid: number;
  user: string;
  database: string;
  application_name: string;
  client_addr: string | null;
  state: string;
  state_changed_at: string | null;
  duration_seconds: number;
  wait_event_type: string | null;
  wait_event: string | null;
  query?: string;
}

export interface ConnectionSummary {
  total: number;
  max_connections: number;
  utilization_pct: number;
  by_state: {
    active: number;
    idle: number;
    idle_in_transaction: number;
    waiting: number;
    other: number;
  };
}

export interface GetConnectionsOutput {
  summary?: ConnectionSummary;
  connections?: ConnectionInfo[];
  warnings?: string[];
  error?: string;
  timestamp?: string;
}

export async function getConnectionsTool(input: unknown): Promise<GetConnectionsOutput> {
  try {
    const validation = validateInput(GetConnectionsInputSchema, input);
    if (!validation.success) {
      return { error: `Input validation failed: ${validation.error}` };
    }

    const { include_queries } = validation.data;
    const db = getDb();

    const maxConnResult = await sql<{ max_connections: number }>`
      SELECT setting::int as max_connections FROM pg_settings WHERE name = 'max_connections'
    `.execute(db);

    const maxConnections = maxConnResult.rows[0]?.max_connections ?? 100;

    // biome-ignore lint/suspicious/noExplicitAny: pg_stat_activity columns cast to ConnectionInfo downstream
    const connectionsResult = await sql<any>`
      SELECT
        pid,
        usename as user,
        datname as database,
        application_name,
        client_addr::text,
        state,
        state_change::text as state_changed_at,
        EXTRACT(EPOCH FROM (now() - state_change))::int as duration_seconds,
        wait_event_type,
        wait_event,
        query
      FROM pg_stat_activity
      WHERE datname IS NOT NULL
      ORDER BY state, duration_seconds DESC
    `.execute(db);

    const rows = connectionsResult.rows as ConnectionInfo[];

    const byState = { active: 0, idle: 0, idle_in_transaction: 0, waiting: 0, other: 0 };
    for (const row of rows) {
      if (row.wait_event_type === "Lock") byState.waiting++;
      else if (row.state === "active") byState.active++;
      else if (row.state === "idle") byState.idle++;
      else if (row.state === "idle in transaction") byState.idle_in_transaction++;
      else byState.other++;
    }

    const total = rows.length;
    const utilizationPct = Math.round((total / maxConnections) * 100);

    const summary: ConnectionSummary = {
      total,
      max_connections: maxConnections,
      utilization_pct: utilizationPct,
      by_state: byState,
    };

    const warnings: string[] = [];

    const longIdleTx = rows.filter(
      (r) => r.state === "idle in transaction" && r.duration_seconds > 300,
    );
    if (longIdleTx.length > 0) {
      warnings.push(`${longIdleTx.length} connections idle-in-transaction for > 5 minutes`);
    }

    if (utilizationPct > 70) {
      warnings.push(`Connection utilization at ${utilizationPct}%`);
    }

    const waitingCount = byState.waiting;
    if (waitingCount > 0) {
      warnings.push(`${waitingCount} connections waiting on locks`);
    }

    const connections: ConnectionInfo[] = include_queries
      ? rows
      : rows.map(({ query, ...rest }) => rest);

    return {
      summary,
      connections,
      warnings,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
