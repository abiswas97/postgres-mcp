---
name: database-health
description: Diagnose database health issues including cache performance, connection saturation, vacuum status, and unused indexes. Use when investigating database problems or running routine health checks.
---

Run the diagnose_database MCP tool to get a composite health assessment.

Interpret results by status:
- critical: Address critical checks immediately. Common actions: kill idle-in-transaction connections, run VACUUM on bloated tables, increase shared_buffers for low cache hit ratio.
- warning: Schedule maintenance. Review unused indexes for removal, check vacuum schedules, monitor connection trends.
- healthy: Confirm health. Note any checks_skipped that may need extension installation.

If slow queries appear in results, offer to run get_slow_queries for deeper analysis.
If connection issues appear, offer to run get_connections for per-connection detail.
If pg_stat_statements is not installed, suggest enabling it for slow query visibility.
