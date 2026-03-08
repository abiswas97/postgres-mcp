---
name: connection-debug
description: Debug database connection issues including too many connections, idle transactions, lock contention, and connection pool exhaustion. Use when the database is unresponsive, connections are refused, or queries are stuck waiting.
---

Workflow:
1. Run get_connections with include_queries=true to see all active connections
2. Check warnings for idle-in-transaction connections. If any are > 10 minutes, suggest terminating with SELECT pg_terminate_backend(pid)
3. If utilization > 80%, identify top consumers by application_name or user
4. If any connections show wait_event_type = 'Lock', run diagnose_database to see blocking lock chains
5. Suggest remediation: increase max_connections, configure connection pooling (PgBouncer), set idle_in_transaction_session_timeout, fix application connection leaks
