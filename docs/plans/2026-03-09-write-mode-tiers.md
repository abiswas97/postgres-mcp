# Write Mode Tiers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `ALLOW_DDL` env var so DDL operations (CREATE, ALTER, DROP, TRUNCATE, etc.) can be enabled independently of DML writes, while keeping truly dangerous ops permanently blocked.

**Architecture:** Split the single `DANGEROUS_OPERATIONS` array in `validateSqlSafety()` into two groups: `PERMANENTLY_BLOCKED` (GRANT, REVOKE, BACKUP, RESTORE, COPY, ATTACH, DETACH, PRAGMA — always blocked) and `DDL_OPERATIONS` (CREATE, ALTER, DROP, TRUNCATE, REINDEX, VACUUM, ANALYZE, CLUSTER — blocked unless `READ_ONLY=false` AND `ALLOW_DDL=true`). Add `isAllowDdlMode()` helper alongside the existing `isReadOnlyMode()`.

**Tech Stack:** TypeScript, Jest (with `jest.resetModules()` + dynamic imports for env-var testing)

---

### Task 1: Write failing DDL tests

**Files:**
- Create: `tests/unit/tools/query-ddl.test.ts`

**Step 1: Create the test file**

```typescript
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanupDatabase } from "../../helpers/cleanup";

jest.mock("kysely", () => ({
  sql: {
    raw: jest.fn((query: string) => ({
      execute: jest.fn(() => {
        if (query.includes("ERROR")) {
          return Promise.reject(new Error("Mocked SQL error"));
        }
        if (
          query.toUpperCase().startsWith("SELECT") ||
          query.toUpperCase().startsWith("WITH") ||
          query.toUpperCase().startsWith("EXPLAIN")
        ) {
          return Promise.resolve({ rows: [{ id: 1 }] });
        }
        return Promise.resolve({ numAffectedRows: 1 });
      }),
    })),
  },
  Kysely: jest.fn(),
  PostgresDialect: jest.fn(),
}));

jest.mock("../../../src/db", () => ({
  getDb: jest.fn(() => ({})),
  closeDb: jest.fn(() => Promise.resolve()),
}));

describe("Query Tool DDL Mode Tests", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = "development";
  });

  afterEach(async () => {
    await cleanupDatabase();
    jest.clearAllMocks();
    process.env = originalEnv;
  });

  describe("DDL blocked by default (READ_ONLY=true)", () => {
    beforeEach(() => {
      process.env.READ_ONLY = "true";
      delete process.env.ALLOW_DDL;
    });

    const ddlQueries = [
      "CREATE TABLE users (id INT)",
      "ALTER TABLE users ADD COLUMN email TEXT",
      "DROP TABLE users",
      "TRUNCATE users",
      "REINDEX TABLE users",
      "VACUUM users",
      "ANALYZE users",
      "CLUSTER users USING users_pkey",
    ];

    for (const query of ddlQueries) {
      test(`should block '${query.split(" ")[0]}' in read-only mode`, async () => {
        const { queryTool } = await import("../../../src/tools/query");
        const result = await queryTool({ sql: query });
        expect(result.error).toBeDefined();
        expect(result.rows).toBeUndefined();
      });
    }
  });

  describe("DDL blocked when READ_ONLY=false but ALLOW_DDL not set", () => {
    beforeEach(() => {
      process.env.READ_ONLY = "false";
      delete process.env.ALLOW_DDL;
    });

    const ddlQueries = [
      "CREATE TABLE users (id INT)",
      "ALTER TABLE users ADD COLUMN email TEXT",
      "DROP TABLE users",
      "TRUNCATE users",
    ];

    for (const query of ddlQueries) {
      test(`should block '${query.split(" ")[0]}' when ALLOW_DDL not set`, async () => {
        const { queryTool } = await import("../../../src/tools/query");
        const result = await queryTool({ sql: query });
        expect(result.error).toBeDefined();
        expect(result.error).toContain("DDL");
        expect(result.rows).toBeUndefined();
      });
    }
  });

  describe("DDL blocked when ALLOW_DDL=true but READ_ONLY not disabled", () => {
    beforeEach(() => {
      process.env.READ_ONLY = "true";
      process.env.ALLOW_DDL = "true";
    });

    test("should block CREATE when READ_ONLY=true even if ALLOW_DDL=true", async () => {
      const { queryTool } = await import("../../../src/tools/query");
      const result = await queryTool({ sql: "CREATE TABLE users (id INT)" });
      expect(result.error).toBeDefined();
      expect(result.rows).toBeUndefined();
    });
  });

  describe("DDL allowed when READ_ONLY=false AND ALLOW_DDL=true", () => {
    beforeEach(() => {
      process.env.READ_ONLY = "false";
      process.env.ALLOW_DDL = "true";
    });

    const ddlQueries = [
      "CREATE TABLE users (id INT)",
      "ALTER TABLE users ADD COLUMN email TEXT",
      "DROP TABLE users",
      "TRUNCATE users",
      "REINDEX TABLE users",
      "VACUUM users",
      "ANALYZE users",
      "CLUSTER users USING users_pkey",
    ];

    for (const query of ddlQueries) {
      test(`should allow '${query.split(" ")[0]}' when fully unlocked`, async () => {
        const { queryTool } = await import("../../../src/tools/query");
        const result = await queryTool({ sql: query });
        expect(result.error).toBeUndefined();
      });
    }
  });

  describe("Permanently blocked operations never unlock", () => {
    beforeEach(() => {
      process.env.READ_ONLY = "false";
      process.env.ALLOW_DDL = "true";
    });

    const permanentlyBlocked = [
      "GRANT SELECT ON users TO public",
      "REVOKE SELECT ON users FROM public",
      "COPY users TO '/tmp/out.csv'",
      "ATTACH DATABASE '/tmp/db.sqlite' AS other",
    ];

    for (const query of permanentlyBlocked) {
      test(`should always block '${query.split(" ")[0]}'`, async () => {
        const { queryTool } = await import("../../../src/tools/query");
        const result = await queryTool({ sql: query });
        expect(result.error).toBeDefined();
        expect(result.rows).toBeUndefined();
      });
    }
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd /Users/abiswas/code/personal/postgres-mcp-server
npx jest tests/unit/tools/query-ddl.test.ts --no-coverage 2>&1 | tail -30
```

Expected: Tests fail — currently DDL ops are in DANGEROUS_OPERATIONS and always blocked, so the "allowed" tests fail; the error message tests fail because error says "Dangerous operation" not "DDL".

**Step 3: Commit the failing tests**

```bash
git add tests/unit/tools/query-ddl.test.ts
git commit -m "test: add failing DDL tier tests"
```

---

### Task 2: Implement DDL tier in validateSqlSafety

**Files:**
- Modify: `src/tools/query.ts:8-86`

**Step 1: Replace the DANGEROUS_OPERATIONS array and add helpers**

In `src/tools/query.ts`, replace lines 8-86 with:

```typescript
function isReadOnlyMode(): boolean {
  return process.env.READ_ONLY !== "false";
}

function isAllowDdlMode(): boolean {
  return !isReadOnlyMode() && process.env.ALLOW_DDL === "true";
}

// Never allowed regardless of configuration
const PERMANENTLY_BLOCKED = [
  "GRANT",
  "REVOKE",
  "COPY",
  "BACKUP",
  "RESTORE",
  "ATTACH",
  "DETACH",
  "PRAGMA",
];

// Allowed only when READ_ONLY=false AND ALLOW_DDL=true
const DDL_OPERATIONS = [
  "CREATE",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "REINDEX",
  "VACUUM",
  "ANALYZE",
  "CLUSTER",
];

function validateSqlSafety(sqlString: string): {
  isValid: boolean;
  error?: string;
} {
  if (!sqlString || typeof sqlString !== "string") {
    return {
      isValid: false,
      error: "SQL query is required and must be a string",
    };
  }

  const trimmedSql = sqlString.trim();
  if (!trimmedSql) {
    return { isValid: false, error: "SQL query cannot be empty" };
  }

  const upperSql = trimmedSql.toUpperCase();

  for (const blocked of PERMANENTLY_BLOCKED) {
    const regex = new RegExp(`\\b${blocked}\\b`, "i");
    if (regex.test(upperSql)) {
      return {
        isValid: false,
        error: `Operation '${blocked}' is not allowed`,
      };
    }
  }

  if (!isAllowDdlMode()) {
    for (const ddl of DDL_OPERATIONS) {
      const regex = new RegExp(`\\b${ddl}\\b`, "i");
      if (regex.test(upperSql)) {
        return {
          isValid: false,
          error: `DDL operation '${ddl}' requires READ_ONLY=false and ALLOW_DDL=true`,
        };
      }
    }
  }

  if (isReadOnlyMode()) {
    const isReadOnly =
      upperSql.startsWith("SELECT") ||
      upperSql.startsWith("WITH") ||
      upperSql.startsWith("EXPLAIN");

    if (!isReadOnly) {
      return {
        isValid: false,
        error: "Only SELECT, WITH, and EXPLAIN queries are allowed in read-only mode",
      };
    }
  } else {
    if (upperSql.includes("UPDATE") || upperSql.includes("DELETE")) {
      if (!validateWhereClause(upperSql)) {
        return {
          isValid: false,
          error:
            "UPDATE and DELETE operations must include a valid WHERE clause (not WHERE 1=1, WHERE true, etc.)",
        };
      }
    }
  }

  return { isValid: true };
}
```

**Step 2: Run the DDL tests**

```bash
npx jest tests/unit/tools/query-ddl.test.ts --no-coverage 2>&1 | tail -30
```

Expected: All tests pass.

**Step 3: Run full test suite to check for regressions**

```bash
npm test 2>&1 | tail -20
```

Expected: All 337+ tests pass (the existing security tests use "Dangerous operation" in their error message assertions — check if any need updating).

**Step 4: Fix any broken security tests**

If existing tests in `query-security.test.ts` or `query-readonly.test.ts` assert on the old error message `"Dangerous operation"`, update those assertions to match the new messages:
- `"Operation '${op}' is not allowed"` — for permanently blocked ops
- `"DDL operation '${op}' requires READ_ONLY=false and ALLOW_DDL=true"` — for DDL ops

Search for affected tests:
```bash
cd /Users/abiswas/code/personal/postgres-mcp-server
grep -n "Dangerous operation" tests/unit/tools/query-security.test.ts tests/unit/tools/query-readonly.test.ts
```

Update each assertion to match the new message format.

**Step 5: Run full test suite again**

```bash
npm test 2>&1 | tail -20
```

Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/tools/query.ts tests/unit/tools/query-security.test.ts tests/unit/tools/query-readonly.test.ts
git commit -m "feat: add DDL tier with ALLOW_DDL env var"
```

---

### Task 3: Update documentation

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md`

**Step 1: Add ALLOW_DDL to .env.example**

Find the security configuration section in `.env.example` and add after the `READ_ONLY` line:

```
# ALLOW_DDL=false        # Enable DDL operations (CREATE, ALTER, DROP, TRUNCATE, etc.)
                         # Requires READ_ONLY=false. Use with extreme caution.
```

**Step 2: Update CLAUDE.md security configuration table**

In the `### Environment Configuration` > `**Security Configuration:**` section, add:

```
- `ALLOW_DDL` (default: false) - When true (and READ_ONLY=false), enables DDL operations (CREATE, ALTER, DROP, TRUNCATE, REINDEX, VACUUM, ANALYZE, CLUSTER)
```

**Step 3: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs: document ALLOW_DDL env var"
```
