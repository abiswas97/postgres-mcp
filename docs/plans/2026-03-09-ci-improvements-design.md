# CI Improvements Design

**Goal:** Add Biome for linting and formatting, restructure GitHub Actions into parallel jobs, upgrade Node.js versions, and consolidate publish logic into npm scripts.

**Architecture:** Biome replaces ESLint + Prettier with a single tool and config. CI splits into four parallel jobs (lint, typecheck, unit-tests, integration-tests) with a matrix on Node 20 + 22 for unit tests. A `validate` script ties lint + typecheck together for local and publish use.

**Tech Stack:** Biome 2.x, TypeScript (`tsc --noEmit`), GitHub Actions, Node.js 20 + 22, ubuntu-latest (Docker available for integration tests).

---

## Component 1: Biome Setup

**Files:**
- Create: `biome.json`
- Modify: `package.json` (devDependencies + scripts)

**Biome config (`biome.json`):**
- Formatter: 2-space indent, 100 char line width, double quotes
- Linter: recommended rules enabled, `correctness`, `suspicious`, `style` rule groups
- Files include: `src/**`, `tests/**`

**New npm scripts:**
- `lint`: `biome check src tests`
- `lint:fix`: `biome check --write src tests`
- `format`: `biome format --write src tests`
- `typecheck`: `tsc --noEmit`
- `validate`: `npm run lint && npm run typecheck`
- `prepublishOnly` (update): `npm run validate && npm run build && npm test`

---

## Component 2: CI Workflow Restructure

**File:** `.github/workflows/test.yml`

**Job graph:**

```
lint (Node 22)   typecheck (Node 22)   unit-tests (matrix: Node 20, 22)
      │                  │                          │
      └──────────────────┴──────────────────────────┘
                         │
               integration-tests (Node 22)
               needs: [lint, typecheck, unit-tests]
```

**Job details:**
- All jobs: `actions/setup-node@v4` with `cache: 'npm'`, `npm ci`
- `lint`: runs `npm run lint`
- `typecheck`: runs `npm run typecheck`
- `unit-tests`: matrix `[20, 22]`, runs `npm run test:unit`
- `integration-tests`: Node 22, runs `npm run test:integration`, Docker available on `ubuntu-latest` by default

---

## Component 3: Publish Workflow Simplification

**File:** `.github/workflows/publish.yml`

Remove inline lint/build/test commands. The workflow runs `npm publish`, which triggers `prepublishOnly` automatically (`npm run validate && npm run build && npm test`).
