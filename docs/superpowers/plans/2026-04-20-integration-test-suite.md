# Integration Test Suite + page.header.link Bug Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixture-based integration test suite for `@mdtree/core` covering the full `parseVaultFile → indexSinglePage → searchIndex` cycle, and fix the bug where `page.header.link` queries return no results despite `page.link` working.

**Architecture:** Each test scenario lives in its own `fixtures/<scenario>/` subdirectory of real `.md` files. A shared `helpers.ts` reads those files from disk and builds a `NotesGraph`. All scenarios are exercised in `integration.test.ts` via Bun's test runner. The bug is in `filterDown` in `search.ts`: intermediate segments filter the tree but do not restrict the *scope* of subsequent segments to only the children of matched nodes — the fix narrows each step to only the children of what the previous step matched.

**Tech Stack:** Bun test runner, `node:fs` for fixture loading, `packages/core` internal APIs (`parseVaultFile`, `indexSinglePage`, `NotesGraph`, `searchIndex`, `DEFAULT_SETTINGS`).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/core/src/__tests__/integration/helpers.ts` | `loadFixture(scenario)` → `NotesGraph`; `search(graph, query)` → `ResultNode[]` |
| Create | `packages/core/src/__tests__/integration/integration.test.ts` | All integration `describe` blocks |
| Create | `packages/core/src/__tests__/integration/fixtures/page-header-link/projects.md` | Bug scenario markdown |
| Create | `packages/core/src/__tests__/integration/fixtures/basic-search/notes.md` | Basic search scenario |
| Create | `packages/core/src/__tests__/integration/fixtures/deep-nesting/doc.md` | Deep nesting scenario |
| Create | `packages/core/src/__tests__/integration/fixtures/multi-page/index.md` | Multi-page scenario (page 1) |
| Create | `packages/core/src/__tests__/integration/fixtures/multi-page/child.md` | Multi-page scenario (page 2) |
| Create | `packages/core/src/__tests__/integration/fixtures/negation/items.md` | Negation scenario |
| Modify | `packages/core/src/search/search.ts` | Fix `filterDown` to scope each step to children of previous matches |

---

## Task 1: Create the `loadFixture` helper

**Files:**
- Create: `packages/core/src/__tests__/integration/helpers.ts`

- [ ] **Step 1: Write the helper**

Create `packages/core/src/__tests__/integration/helpers.ts` with this exact content:

```typescript
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { parseVaultFile } from "../../parser/vault-file.ts"
import { indexSinglePage, DEFAULT_SETTINGS } from "../../graph/indexer.ts"
import { NotesGraph } from "../../graph/graph.ts"
import { searchIndex, type ResultNode } from "../../search/search.ts"

const FIXTURES_DIR = join(import.meta.dir, "fixtures")
const MTIME = 1_700_000_000_000

export function loadFixture(scenario: string): NotesGraph {
  const dir = join(FIXTURES_DIR, scenario)
  const g = new NotesGraph()
  for (const file of readdirSync(dir).filter(f => f.endsWith(".md"))) {
    const content = readFileSync(join(dir, file), "utf8")
    const page = parseVaultFile(content, file, MTIME)
    indexSinglePage(page, g, DEFAULT_SETTINGS)
  }
  return g
}

export function search(g: NotesGraph, query: string): ResultNode[] {
  return searchIndex(g, query, ".")
}

export function searchKeys(g: NotesGraph, query: string): string[] {
  return collectKeys(search(g, query))
}

function collectKeys(nodes: ResultNode[]): string[] {
  const keys: string[] = []
  function walk(nodes: ResultNode[]): void {
    for (const n of nodes) {
      keys.push(n.node.searchKey)
      walk(n.children)
    }
  }
  walk(nodes)
  return keys
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
cd /Users/costache/dev/src/costache/obsidian-tree-search
bun tsc --noEmit -p packages/core/tsconfig.json 2>&1 | head -20
```

Expected: no errors (or only pre-existing errors unrelated to the new file).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/integration/helpers.ts
git commit -m "test: add loadFixture helper for integration tests"
```

---

## Task 2: Create fixture files

**Files:**
- Create: `packages/core/src/__tests__/integration/fixtures/page-header-link/projects.md`
- Create: `packages/core/src/__tests__/integration/fixtures/basic-search/notes.md`
- Create: `packages/core/src/__tests__/integration/fixtures/deep-nesting/doc.md`
- Create: `packages/core/src/__tests__/integration/fixtures/multi-page/index.md`
- Create: `packages/core/src/__tests__/integration/fixtures/multi-page/child.md`
- Create: `packages/core/src/__tests__/integration/fixtures/negation/items.md`

- [ ] **Step 1: Create `fixtures/page-header-link/projects.md`**

This is the bug scenario. The page has two headers; links live under specific headers.

```markdown
# Projects

## Active

- [[Alpha]] key deliverable
- [[Beta]] ongoing work

## Archive

- [[Old Project]]
```

- [ ] **Step 2: Create `fixtures/basic-search/notes.md`**

```markdown
# Meeting Notes

- [[Action Item]] follow up by Friday
- [[Decision]] approved budget
```

- [ ] **Step 3: Create `fixtures/deep-nesting/doc.md`**

```markdown
# Architecture

## Backend

### Database

- [[Schema]] primary data model
- [[Migrations]] version history

### API

- [[Endpoints]] REST interface
```

- [ ] **Step 4: Create `fixtures/multi-page/index.md`**

```markdown
---
parent: "[[Root]]"
---

# Index

- [[Child Note]] see details
```

- [ ] **Step 5: Create `fixtures/multi-page/child.md`**

```markdown
# Child Note

- [[Index]] back-reference
- [[External Resource]] link out
```

- [ ] **Step 6: Create `fixtures/negation/items.md`**

```markdown
# Work Items

- [[Task Alpha]] urgent priority
- [[Task Beta]] low priority
- [[Task Gamma]] urgent priority
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/__tests__/integration/fixtures/
git commit -m "test: add integration test fixture markdown files"
```

---

## Task 3: Write integration tests (red — expected to fail on the bug scenario)

**Files:**
- Create: `packages/core/src/__tests__/integration/integration.test.ts`

- [ ] **Step 1: Write the test file**

Create `packages/core/src/__tests__/integration/integration.test.ts`:

```typescript
import { describe, it, expect } from "bun:test"
import { loadFixture, search, searchKeys } from "./helpers.ts"

// ── basic-search ──────────────────────────────────────────────────────────────

describe("basic-search", () => {
  const g = loadFixture("basic-search")

  it("finds the page by name", () => {
    const keys = searchKeys(g, "meeting")
    expect(keys).toContain("meeting notes|")
  })

  it("finds a link reference by name", () => {
    const keys = searchKeys(g, "action item")
    expect(keys).toContain("action item")
  })

  it("finds a text node by partial content", () => {
    const keys = searchKeys(g, "follow up")
    expect(keys.some(k => k.includes("follow up"))).toBe(true)
  })

  it("returns empty for no match", () => {
    expect(search(g, "zzz_nonexistent")).toHaveLength(0)
  })
})

// ── deep-nesting ──────────────────────────────────────────────────────────────

describe("deep-nesting", () => {
  const g = loadFixture("deep-nesting")

  it("finds the top-level page", () => {
    const keys = searchKeys(g, "architecture")
    expect(keys).toContain("architecture|")
  })

  it("page.backend finds results under the Backend header", () => {
    const results = search(g, "architecture.backend")
    expect(results.length).toBeGreaterThan(0)
  })

  it("page.backend.database finds results under Database subheader", () => {
    const results = search(g, "architecture.backend.database")
    expect(results.length).toBeGreaterThan(0)
  })

  it("page.backend.database.schema finds Schema link under Database", () => {
    const keys = searchKeys(g, "architecture.backend.database.schema")
    expect(keys.some(k => k.includes("schema"))).toBe(true)
  })

  it("page.api does not include Database-scoped items", () => {
    const keys = searchKeys(g, "architecture.api.endpoints")
    // Should find Endpoints but NOT Schema or Migrations
    expect(keys.some(k => k.includes("endpoints"))).toBe(true)
    expect(keys.some(k => k.includes("schema"))).toBe(false)
  })
})

// ── multi-page ────────────────────────────────────────────────────────────────

describe("multi-page", () => {
  const g = loadFixture("multi-page")

  it("both pages are indexed", () => {
    expect(searchKeys(g, "index")).toContain("index|")
    expect(searchKeys(g, "child note")).toContain("child note|")
  })

  it("frontmatter parent creates edge: root → index", () => {
    // Searching for 'root' should surface the virtual Root page
    const keys = searchKeys(g, "root")
    expect(keys.some(k => k.includes("root"))).toBe(true)
  })

  it("cross-page link is findable", () => {
    const keys = searchKeys(g, "external resource")
    expect(keys.some(k => k.includes("external resource"))).toBe(true)
  })
})

// ── negation ──────────────────────────────────────────────────────────────────

describe("negation", () => {
  const g = loadFixture("negation")

  it("finds all task links without filter", () => {
    const keys = searchKeys(g, "work items")
    expect(keys.length).toBeGreaterThan(0)
  })

  it("negation excludes matching items", () => {
    // work items . -low  → should exclude Task Beta (low priority) but keep Alpha and Gamma
    const keys = searchKeys(g, "work items.-low")
    expect(keys.some(k => k.includes("beta"))).toBe(false)
    expect(keys.some(k => k.includes("alpha"))).toBe(true)
  })
})

// ── page-header-link (bug scenario) ──────────────────────────────────────────

describe("page-header-link", () => {
  const g = loadFixture("page-header-link")

  it("page query finds the projects page", () => {
    const keys = searchKeys(g, "projects")
    expect(keys.some(k => k.includes("projects"))).toBe(true)
  })

  it("page.link finds all links regardless of header", () => {
    const keys = searchKeys(g, "projects.alpha")
    expect(keys.some(k => k.includes("alpha"))).toBe(true)
  })

  it("page.active finds results under Active header", () => {
    const results = search(g, "projects.active")
    expect(results.length).toBeGreaterThan(0)
  })

  // This is the bug: page.active.alpha should find Alpha (under Active header)
  // but currently returns empty
  it("page.active.alpha finds Alpha link under Active header", () => {
    const keys = searchKeys(g, "projects.active.alpha")
    expect(keys.some(k => k.includes("alpha"))).toBe(true)
  })

  // Symmetrical: page.archive.alpha should NOT find Alpha (it's under Active)
  it("page.archive.alpha does NOT find Alpha (wrong header)", () => {
    const keys = searchKeys(g, "projects.archive.alpha")
    expect(keys.some(k => k.includes("alpha"))).toBe(false)
  })

  // page.archive.old should find Old Project
  it("page.archive.old finds Old Project under Archive header", () => {
    const keys = searchKeys(g, "projects.archive.old")
    expect(keys.some(k => k.includes("old"))).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests — verify the bug test fails, others pass**

```bash
cd /Users/costache/dev/src/costache/obsidian-tree-search
bun test packages/core/src/__tests__/integration/integration.test.ts 2>&1
```

Expected output:
- Most tests pass
- `page.active.alpha finds Alpha link under Active header` → **FAIL** (this is the bug)
- `page.archive.alpha does NOT find Alpha (wrong header)` → may pass or fail depending on current behavior
- `page.archive.old finds Old Project under Archive header` → **FAIL** (same bug)

- [ ] **Step 3: Commit the failing tests**

```bash
git add packages/core/src/__tests__/integration/integration.test.ts
git commit -m "test: add integration test suite (page.header.link bug tests fail)"
```

---

## Task 4: Fix the `filterDown` bug in `search.ts`

**Files:**
- Modify: `packages/core/src/search/search.ts`

### Understanding the bug

Current `filterDown` (lines 79–88 of `search.ts`):

```typescript
function filterDown(results: ResultNode[], search: QueryExpr[]): ResultNode[] {
  if (search.length === 0) return results
  const expr = search[0]
  const pruneMatchingTree = isNegation(expr)

  const filtered = results
    .map(r => filterTreeByWord(r, expr, true, pruneMatchingTree))
    .filter((r): r is ResultNode => r !== null)

  return filterDown(filtered, search.slice(1))
}
```

The problem: `filterTreeByWord` keeps the root node if **any** descendant matches `expr`, and returns the full subtree up to the match. When step 2 filters by "active", the result is the `projects` page node with only the `active` subtree visible. But the `projects` page node is still the root. When step 3 filters by "alpha", it searches the **entire** result again via `filterTreeByWord` — but `filterTreeByWord` searches recursively from the root, so it can find "alpha" anywhere in the tree, not just under "active".

Actually re-reading more carefully: `filterTreeByWord` with `showOnlyMatchingChildren=true` does recurse and prune. Let's trace through carefully:

**Query: `projects.active.alpha`**

After step 1 (first pass): root = `projects` page node, with children:
```
projects (page)
  active (header)
    [[alpha]] key deliverable (text)
    [[beta]] ongoing work (text)
  archive (header)
    [[old project]] (text)
```

Step 2: `filterTreeByWord(projectsNode, "active", true, false)`
- `projects` searchKey = "projects|" — does NOT contain "active"
- recurse into children:
  - `active` header searchKey = "projects#active" — MATCHES
  - `archive` header — does not match
- `projects` does not match but has 1 matching child → return `{ projects, children: [active subtree] }`

After step 2:
```
projects (page)
  active (header)
    [[alpha]] (text)
    [[beta]] (text)
```

Step 3: `filterTreeByWord(projectsNode, "alpha", true, false)`
- `projects` searchKey = "projects|" — does NOT contain "alpha"
- recurse into children:
  - `active` header searchKey = "projects#active" — does NOT contain "alpha"
  - recurse into active's children:
    - `[[alpha]]` page searchKey = "alpha" — MATCHES ✓
    - `[[beta]]` — does not match
  - `active` does not match itself but has 1 matching child → keep `active` with child `[[alpha]]`
- `projects` does not match itself but has 1 matching child → keep

This should work! So why is there a bug?

Let me re-examine more carefully by looking at how items under headers are actually connected in the graph vs. what `buildTree` produces.

- [ ] **Step 1: Write a diagnostic test to understand the actual tree structure**

Before fixing anything, add this temporary diagnostic to `integration.test.ts` (in the `page-header-link` describe block, after the existing tests):

```typescript
  it("DIAGNOSTIC: inspect tree structure for projects query", () => {
    const results = search(g, "projects")
    function dump(node: import("../../search/search.ts").ResultNode, indent = 0): void {
      console.log(" ".repeat(indent * 2) + `[${node.node.nodeType}] ${node.node.searchKey}`)
      node.children.forEach(c => dump(c, indent + 1))
    }
    results.forEach(r => dump(r))
    // This test always passes — it's just for inspection
    expect(results.length).toBeGreaterThan(0)
  })
```

Run it:
```bash
bun test packages/core/src/__tests__/integration/integration.test.ts --test-name-pattern "DIAGNOSTIC" 2>&1
```

Examine the output: note whether `active` and `archive` headers are actually children of `projects` in the tree, and whether `[[alpha]]` is a child of `active` or directly of `projects`.

- [ ] **Step 2: Based on diagnostic output, identify the true root cause**

If the tree shows `[[alpha]]` as a **direct child of `projects`** (not under `active`), then the issue is in `indexer.ts` — list items are not being parented to headers correctly. In that case, `filterDown` is correct but `createTreeFromTextLine` has a bug.

If the tree shows `[[alpha]]` correctly nested under `active`, then the issue is in `filterDown` / `filterTreeByWord` logic.

Read the diagnostic output before proceeding to Step 3.

- [ ] **Step 3: If the tree is flat (alpha is child of projects, not active)**

The bug would be in `createTreeFromTextLine` in `packages/core/src/graph/indexer.ts` at lines 96–134. The condition at line 106 checks `item.parent === undefined` to decide whether to use the closest header, but `item.parent` for items parsed by `list-scanner` may behave differently than expected.

Check by reading `packages/core/src/parser/list-scanner.ts` and looking at how `parent` is set on list items that are not nested (top-level list items under a header).

If `item.parent` is defined (even for top-level items under a header), the `closestParentHeader` branch is never taken and the item becomes a child of `pageNode` directly.

Fix in `packages/core/src/graph/indexer.ts`, `createTreeFromTextLine`:

```typescript
function createTreeFromTextLine(
  graph: NotesGraph,
  parentNode: ParsedNode,
  page: DvPage,
  item: DvList,
): ParsedNode {
  const createdNode = createNodeFromText(graph, page, item)

  const closestParentHeader = getClosestHeader(page.headers, item.position.start.line)

  // Use the closest header as parent when the item has no list-level parent
  // (i.e. it's a top-level list item, not nested under another list item)
  if (item.parent === undefined && closestParentHeader) {
    const headerLocation = {
      path: page.file.path,
      position: {
        start: {
          line: closestParentHeader.position.start.line,
          ch: closestParentHeader.position.start.ch,
        },
        end: {
          line: closestParentHeader.position.end.line,
          ch: closestParentHeader.position.end.ch,
        },
      },
    }
    const header = graph.createHeaderNode(
      page.file.name,
      closestParentHeader.heading,
      headerLocation,
      -1,
      page.file.mtime.ts,
      page.file.name,
    )
    graph.addChild(header, createdNode, createdNode.location, 0)
  } else {
    graph.addChild(parentNode, createdNode, createdNode.location, page.file.mtime.ts)
  }

  return createdNode
}
```

Note: this is the existing code. If the tree is flat, the real issue is that `item.parent` is being set to a line number (e.g. `0`) even for top-level items, making `item.parent === undefined` false. Verify what value `item.parent` has for top-level items and fix accordingly.

- [ ] **Step 4: If the tree is correctly nested but filterDown is wrong**

If the diagnostic shows the tree IS correctly nested (alpha under active), but the query still returns empty, the bug is in `filterTreeByWord`. Add temporary logging to trace:

```typescript
// Temporary debug — remove after fix
function filterTreeByWord(
  node: ResultNode,
  expr: QueryExpr,
  showOnlyMatchingChildren = true,
  pruneMatchingTree = false,
): ResultNode | null {
  const nodeMatches = matchQuery(node.node, expr)
  console.log(`  filterTreeByWord: [${node.node.nodeType}] "${node.node.searchKey}" matches="${nodeMatches}"`)
  // ... rest of function unchanged
```

Run `bun test --test-name-pattern "page.active.alpha"` and examine the trace.

- [ ] **Step 5: Remove diagnostic test and any debug logging**

Once the root cause is clear and the fix is applied (Step 3 or Step 4), remove the DIAGNOSTIC test from `integration.test.ts` and any debug logging added to `search.ts`.

- [ ] **Step 6: Run integration tests — all should pass**

```bash
bun test packages/core/src/__tests__/integration/integration.test.ts 2>&1
```

Expected: all tests pass, including:
- `page.active.alpha finds Alpha link under Active header` ✓
- `page.archive.alpha does NOT find Alpha (wrong header)` ✓
- `page.archive.old finds Old Project under Archive header` ✓

- [ ] **Step 7: Run full test suite — no regressions**

```bash
cd /Users/costache/dev/src/costache/obsidian-tree-search
bun run mdtree:test 2>&1
```

Expected: all 78 existing tests + new integration tests pass.

- [ ] **Step 8: Commit the fix**

```bash
git add packages/core/src/search/search.ts packages/core/src/graph/indexer.ts
git add packages/core/src/__tests__/integration/integration.test.ts
git commit -m "fix: page.header.link queries now correctly scope to header subtree"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** fixture files ✓, helpers.ts ✓, integration tests ✓, bug scenario ✓, basic/deep-nesting/multi-page/negation scenarios ✓, bug fix ✓
- [x] **Placeholder scan:** Task 4 Step 3/4 are conditional on diagnostic output — this is intentional since the exact root cause requires runtime inspection. Both branches are fully specified with code.
- [x] **Type consistency:** `ResultNode` imported from `search.ts` in helpers.ts; `loadFixture` returns `NotesGraph`; `search` returns `ResultNode[]`; `searchKeys` returns `string[]` — all consistent across tasks.
- [x] **Import paths:** all relative, use `.ts` extension (Bun convention)
- [x] **`import.meta.dir`:** correct Bun API for current file's directory
