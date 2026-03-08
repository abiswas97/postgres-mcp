# CI Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Biome for linting and formatting, add npm scripts for validate/typecheck, restructure GitHub Actions into four parallel jobs with Node 20+22 matrix, and simplify the publish workflow.

**Architecture:** Biome replaces any future ESLint/Prettier setup with a single Rust-based tool. CI splits into lint, typecheck, unit-tests (matrix), and integration-tests jobs — integration tests only run after the fast checks pass. `prepublishOnly` drives all validation before publish.

**Tech Stack:** `@biomejs/biome` 2.x, TypeScript `tsc --noEmit`, GitHub Actions, Node.js 20 + 22.

---

### Task 1: Install Biome and create biome.json

**Files:**
- Modify: `package.json` (add devDependency)
- Create: `biome.json`

**Step 1: Install Biome**

```bash
npm install --save-dev @biomejs/biome
```

Expected: `@biomejs/biome` added to `devDependencies` in `package.json`.

**Step 2: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "files": {
    "include": ["src/**", "tests/**"]
  }
}
```

**Step 3: Run Biome against the codebase to see existing issues**

```bash
npx biome check src tests
```

Expected: May report formatting or lint violations. Note any lint errors (not just format warnings) that need manual attention.

**Step 4: Auto-fix all fixable issues**

```bash
npx biome check --write src tests
```

Expected: Biome formats files and fixes safe lint violations. If any unfixable lint errors remain, fix them manually before proceeding.

**Step 5: Verify the codebase is clean**

```bash
npx biome check src tests
```

Expected: Exit 0, no violations.

**Step 6: Verify tests still pass after formatting changes**

```bash
npm test
```

Expected: All 378 tests pass.

**Step 7: Commit**

```bash
git add biome.json package.json package-lock.json src tests
git commit -m "chore: install Biome and apply initial formatting"
```

---

### Task 2: Add npm scripts

**Files:**
- Modify: `package.json` (scripts section)

**Step 1: Update scripts in `package.json`**

Replace the `scripts` section with:

```json
"scripts": {
  "build": "tsc",
  "start": "node dist/index.js",
  "dev": "tsx src/index.ts",
  "test": "jest",
  "test:unit": "jest tests/unit",
  "test:integration": "jest tests/integration",
  "test:watch": "jest --watch",
  "test:coverage": "jest --coverage",
  "lint": "biome check src tests",
  "lint:fix": "biome check --write src tests",
  "format": "biome format --write src tests",
  "typecheck": "tsc --noEmit",
  "validate": "npm run lint && npm run typecheck",
  "prepublishOnly": "npm run validate && npm run build && npm test",
  "version:patch": "npm version patch",
  "version:minor": "npm version minor",
  "version:major": "npm version major"
}
```

**Step 2: Verify `lint` works**

```bash
npm run lint
```

Expected: Exit 0 (clean after Task 1).

**Step 3: Verify `typecheck` works**

```bash
npm run typecheck
```

Expected: Exit 0, no TypeScript errors. Note: `tsconfig.json` includes only `src/**/*` — tests are type-checked by ts-jest during `npm test`.

**Step 4: Verify `validate` works**

```bash
npm run validate
```

Expected: Exit 0 — runs lint then typecheck.

**Step 5: Commit**

```bash
git add package.json
git commit -m "chore: add lint, typecheck, validate, and format scripts"
```

---

### Task 3: Restructure CI workflow (test.yml)

**Files:**
- Modify: `.github/workflows/test.yml`

**Step 1: Replace the entire file**

```yaml
name: Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck

  unit-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: ['20', '22']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      - run: npm ci
      - run: npm run test:unit

  integration-tests:
    runs-on: ubuntu-latest
    needs: [lint, typecheck, unit-tests]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:integration
```

**Step 2: Validate the YAML syntax**

```bash
npx js-yaml .github/workflows/test.yml
```

Expected: Prints the parsed object, no errors. (Or use `cat` to manually review indentation.)

**Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: split into parallel lint, typecheck, unit-tests, integration-tests jobs"
```

---

### Task 4: Simplify publish workflow

**Files:**
- Modify: `.github/workflows/publish.yml`

**Step 1: Replace the entire file**

```yaml
name: Publish to npm

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          registry-url: https://registry.npmjs.org/
          cache: 'npm'
      - run: npm ci
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Note: `npm publish` automatically runs `prepublishOnly` before publishing, which executes `npm run validate && npm run build && npm test`. No inline commands needed in the workflow.

**Step 2: Validate YAML syntax**

```bash
npx js-yaml .github/workflows/publish.yml
```

Expected: Prints the parsed object, no errors.

**Step 3: Commit**

```bash
git add .github/workflows/publish.yml
git commit -m "ci: simplify publish workflow — prepublishOnly handles validation"
```
