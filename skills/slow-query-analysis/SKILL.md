---
name: slow-query-analysis
description: Analyze slow queries and suggest optimizations including missing indexes and query rewrites. Use when investigating query performance, high CPU usage, or slow response times.
---

Workflow:
1. Run get_slow_queries sorted by total_time to find biggest time consumers
2. For the top offender, run explain_query with analyze=true to see the actual execution plan
3. Look for: sequential scans on large tables (suggest index), nested loops with high row counts (suggest join rewrite), sorts spilling to disk (suggest work_mem increase or index)
4. Check list_indexes on affected tables to see what indexes exist
5. Suggest specific actions: CREATE INDEX statements, query rewrites, or configuration changes

If pg_stat_statements is not installed, guide setup:
- Add shared_preload_libraries = 'pg_stat_statements' to postgresql.conf
- Restart PostgreSQL
- Run CREATE EXTENSION pg_stat_statements
- For RDS/Aurora: modify parameter group, reboot instance
