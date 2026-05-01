# meta-mdtree Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `(meta-mdtree:: archive)` inline property that hides annotated subtrees from search results, replacing them with a static "Archive (N items)" indicator.

**Architecture:** A new token type `meta_mdtree` is parsed in the same pipeline as `meta_action` tokens. A pure `partitionArchived()` function (Approach C) sits between search and flattening, splitting results into visible and archived. Raycast actions allow toggling the annotation on/off.

**Tech Stack:** TypeScript, Bun test runner, Jotai (plugin state), `@mdtree/core` (parser/graph/search)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/core/src/graph/types.ts` | Add `MetaMdtreeToken` type to `ParsedTextToken` union |
| `packages/core/src/parser/list-scanner.ts` | Strip `(meta-mdtree:: archive)` from display text |
| `packages/core/src/parser/inline-tokens.ts` | Extract `meta_mdtree` tokens during parsing |
| `packages/core/src/search/archive.ts` | New: `isArchived()` + `partitionArchived()` |
| `packages/core/src/search/copy.ts` | Add `meta_mdtree` case to reverse markdown |
| `packages/core/src/index.ts` | Export new types and functions |
| `packages/core/src/__tests__/archive.test.ts` | New: unit tests for partition logic |
| `packages/core/src/__tests__/indexer.test.ts` | Parser integration tests for meta_mdtree |
| `packages/core/src/__tests__/integration/fixtures/archive/` | New: fixture `.md` files |
| `packages/core/src/__tests__/integration/integration.test.ts` | Integration tests for archive |
| `src/view/node-actions.ts` | Add Archive/Unarchive Raycast actions |
| `src/view/__tests__/node-actions.test.ts` | Tests for archive action visibility |
| `src/view/react-context/state.tsx` | Call `partitionArchived`, append synthetic node |
| `src/view/raycast/raycast-server.ts` | Call `partitionArchived` in Raycast endpoint |
| `src/view/markdown-code-block/InlineMarkdownResults.tsx` | Call `partitionArchived` in inline results |
| `src/main.ts` | Handle `archive`/`unarchive` URI actions |
| `packages/cli/src/server/server.ts` | Call `partitionArchived` in CLI server |
| `packages/cli/src/server/response.ts` | Add `archivedCount` to `VaultResults` type |
| `packages/cli/src/commands/query.ts` | Call `partitionArchived` in query command |

---

### Task 1: Add `MetaMdtreeToken` type

**Files:**
- Modify: `packages/core/src/graph/types.ts:112-119`

- [ ] **Step 1: Add the `MetaMdtreeToken` type and update the union**

In `packages/core/src/graph/types.ts`, add the new token type after `MetaActionToken` (after line 117) and update the `ParsedTextToken` union:

```ts
export type MetaMdtreeToken = {
  tokenType: "meta_mdtree"
  directive: string
}
```

Update the union on line 119 from:

```ts
export type ParsedTextToken = TextToken | ObsidianLinkToken | LinkToken | ImageToken | MetaActionToken
```

to:

```ts
export type ParsedTextToken = TextToken | ObsidianLinkToken | LinkToken | ImageToken | MetaActionToken | MetaMdtreeToken
```

- [ ] **Step 2: Export the new type from the core index**

In `packages/core/src/index.ts`, add `MetaMdtreeToken` to the type exports on lines 1-24. Add it after `MetaActionToken` in the type export block (note: `MetaActionToken` is not currently exported — just add `MetaMdtreeToken` to the existing list):

Add to the type export:
```ts
MetaMdtreeToken,
```

So the relevant line becomes:
```ts
export type {
  // ... existing types ...
  MetaActionToken,
  MetaMdtreeToken,
  ParsedTextToken,
  // ...
} from "./graph/types.ts"
```

- [ ] **Step 3: Verify the build still passes**

Run: `cd /Users/costache/dev/src/costache/obsidian-tree-search && bun run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/graph/types.ts packages/core/src/index.ts
git commit -m "feat(core): add MetaMdtreeToken type to ParsedTextToken union"
```

---

### Task 2: Parse `(meta-mdtree:: archive)` in list-scanner

**Files:**
- Modify: `packages/core/src/parser/list-scanner.ts:1-9,106-118`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/__tests__/indexer.test.ts`, at the end of the file (after the last `describe` block):

```ts
describe("meta-mdtree archive", () => {
  it("meta-mdtree archive syntax does not appear in searchKey", () => {
    const g = buildGraph(
      parse("- My archived item (meta-mdtree:: archive)", "n.md"),
    )
    const nodes = g.filterNodes((_, attrs) => attrs.nodeType === "text")
    expect(nodes.length).toBeGreaterThan(0)
    const textNode = g.getNodeAttributes(nodes[0]) as { searchKey: string; parsedTokens: unknown[] }
    expect(textNode.searchKey).not.toContain("meta-mdtree")
    expect(textNode.searchKey).toContain("my archived item")
  })

  it("parsedTokens contains meta_mdtree token with directive 'archive'", () => {
    const g = buildGraph(
      parse("- My archived item (meta-mdtree:: archive)", "n.md"),
    )
    const nodes = g.filterNodes((_, attrs) => attrs.nodeType === "text")
    expect(nodes.length).toBeGreaterThan(0)
    const textNode = g.getNodeAttributes(nodes[0]) as {
      parsedTokens: Array<{ tokenType: string; directive?: string }>
    }
    const metaToken = textNode.parsedTokens.find(t => t.tokenType === "meta_mdtree")
    expect(metaToken).toBeDefined()
    expect(metaToken?.directive).toBe("archive")
  })

  it("item with only meta-mdtree annotation (no links/tags) is still indexed", () => {
    const g = buildGraph(
      parse("- plain text item (meta-mdtree:: archive)", "n.md"),
    )
    const nodes = g.filterNodes((_, attrs) => {
      if (attrs.nodeType !== "text") return false
      return (attrs as { searchKey: string }).searchKey.includes("plain text item")
    })
    expect(nodes.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/__tests__/indexer.test.ts`
Expected: The three new tests FAIL — the parser doesn't strip `(meta-mdtree:: archive)` yet, so either `searchKey` contains "meta-mdtree" or items are skipped by `shouldSkip`.

- [ ] **Step 3: Add `META_MDTREE_RE` regex and stripping logic to list-scanner**

In `packages/core/src/parser/list-scanner.ts`:

Add the new regex after line 8 (`META_ACTION_RE`):

```ts
const META_MDTREE_RE = /\(meta-mdtree::\s*\w+\)/g
```

Then update lines 106-108. Currently:

```ts
    // strip meta-action properties from text (they go into rawText for token parsing)
    const rawText = text
    text = text.replace(META_ACTION_RE, "").trim()
```

Change to:

```ts
    // strip meta-action and meta-mdtree properties from text (they go into rawText for token parsing)
    const rawText = text
    text = text.replace(META_ACTION_RE, "").replace(META_MDTREE_RE, "").trim()
```

- [ ] **Step 4: Add `meta_mdtree` extraction to inline-tokens**

In `packages/core/src/parser/inline-tokens.ts`:

Import the new type. Change line 4 from:

```ts
import type { MetaActionToken, ParsedTextToken } from "../graph/types.ts"
```

to:

```ts
import type { MetaActionToken, MetaMdtreeToken, ParsedTextToken } from "../graph/types.ts"
```

Add a new regex after `META_ACTION_TRIPLE_RE` (after line 134):

```ts
const META_MDTREE_RE = /\(meta-mdtree::\s*(\w+)\)/g
```

Update the `parseTokens()` function (lines 136-147). Currently:

```ts
export function parseTokens(markdownString: string): ParsedTextToken[] {
  // Extract meta-action triples first, remove them from the string for markdown-it
  const metaActions: MetaActionToken[] = []
  const cleaned = markdownString.replace(META_ACTION_TRIPLE_RE, (_, name, url, icon) => {
    metaActions.push({ tokenType: "meta_action", name, url, icon: icon || undefined })
    return ""
  })

  const md = getMd()
  const tokens = md.parseInline(cleaned.trim(), {})
  return [...parseTokenList(tokens), ...metaActions]
}
```

Change to:

```ts
export function parseTokens(markdownString: string): ParsedTextToken[] {
  // Extract meta-action triples first, remove them from the string for markdown-it
  const metaActions: MetaActionToken[] = []
  let cleaned = markdownString.replace(META_ACTION_TRIPLE_RE, (_, name, url, icon) => {
    metaActions.push({ tokenType: "meta_action", name, url, icon: icon || undefined })
    return ""
  })

  // Extract meta-mdtree directives
  const metaMdtree: MetaMdtreeToken[] = []
  cleaned = cleaned.replace(META_MDTREE_RE, (_, directive) => {
    metaMdtree.push({ tokenType: "meta_mdtree", directive })
    return ""
  })

  const md = getMd()
  const tokens = md.parseInline(cleaned.trim(), {})
  return [...parseTokenList(tokens), ...metaActions, ...metaMdtree]
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test packages/core/src/__tests__/indexer.test.ts`
Expected: All tests PASS, including the three new ones.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/parser/list-scanner.ts packages/core/src/parser/inline-tokens.ts packages/core/src/__tests__/indexer.test.ts
git commit -m "feat(core): parse (meta-mdtree:: archive) inline property"
```

---

### Task 3: Implement `isArchived` and `partitionArchived`

**Files:**
- Create: `packages/core/src/search/archive.ts`
- Create: `packages/core/src/__tests__/archive.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/__tests__/archive.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { isArchived, partitionArchived } from "../search/archive.ts"
import type { ResultNode } from "../search/search.ts"
import type { ParsedNode, TextNode, PageNode } from "../graph/types.ts"

// ── Helpers ──────────────────────────────────────────────────────────────────

const loc = {
  path: "test.md",
  position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 10 } },
}

function textNode(key: string, archived = false): TextNode {
  return {
    nodeType: "text",
    searchKey: key,
    location: loc,
    boost: 0,
    ageDays: 0,
    parsedTokens: archived
      ? [
          { tokenType: "text", text: key, decoration: "none" },
          { tokenType: "meta_mdtree", directive: "archive" },
        ]
      : [{ tokenType: "text", text: key, decoration: "none" }],
    tags: [],
    isTask: false,
    isCompleted: false,
  }
}

function pageNode(key: string): PageNode {
  return {
    nodeType: "page",
    searchKey: key,
    location: loc,
    boost: 0,
    ageDays: 0,
    isReference: false,
    page: key,
    aliases: [],
    tags: [],
  }
}

function rn(node: ParsedNode, children: ResultNode[] = []): ResultNode {
  return { node, children, parents: [] }
}

// ── isArchived ───────────────────────────────────────────────────────────────

describe("isArchived", () => {
  it("returns true for text node with meta_mdtree archive token", () => {
    expect(isArchived(textNode("item", true))).toBe(true)
  })

  it("returns false for text node without meta_mdtree token", () => {
    expect(isArchived(textNode("item", false))).toBe(false)
  })

  it("returns false for non-text nodes", () => {
    expect(isArchived(pageNode("page"))).toBe(false)
  })
})

// ── partitionArchived ────────────────────────────────────────────────────────

describe("partitionArchived", () => {
  it("returns all nodes visible when none are archived", () => {
    const results = [
      rn(textNode("a"), [rn(textNode("b"))]),
      rn(textNode("c")),
    ]
    const { visible, archivedCount } = partitionArchived(results)
    expect(archivedCount).toBe(0)
    expect(visible).toHaveLength(2)
    expect(visible[0].children).toHaveLength(1)
  })

  it("removes root-level archived node with all descendants", () => {
    const results = [
      rn(textNode("archived-root", true), [
        rn(textNode("child1"), [rn(textNode("grandchild"))]),
      ]),
      rn(textNode("visible")),
    ]
    const { visible, archivedCount } = partitionArchived(results)
    expect(archivedCount).toBe(3) // archived-root + child1 + grandchild
    expect(visible).toHaveLength(1)
    expect(visible[0].node.searchKey).toBe("visible")
  })

  it("prunes nested archived node but keeps parent", () => {
    const results = [
      rn(textNode("parent"), [
        rn(textNode("archived-child", true), [rn(textNode("grandchild"))]),
        rn(textNode("visible-child")),
      ]),
    ]
    const { visible, archivedCount } = partitionArchived(results)
    expect(archivedCount).toBe(2) // archived-child + grandchild
    expect(visible).toHaveLength(1)
    expect(visible[0].children).toHaveLength(1)
    expect(visible[0].children[0].node.searchKey).toBe("visible-child")
  })

  it("handles multiple archived nodes at different levels", () => {
    const results = [
      rn(textNode("root1", true), [rn(textNode("c1"))]),
      rn(textNode("root2"), [
        rn(textNode("nested-archived", true), [rn(textNode("c2"))]),
        rn(textNode("kept")),
      ]),
    ]
    const { visible, archivedCount } = partitionArchived(results)
    expect(archivedCount).toBe(4) // root1 + c1 + nested-archived + c2
    expect(visible).toHaveLength(1)
    expect(visible[0].node.searchKey).toBe("root2")
    expect(visible[0].children).toHaveLength(1)
    expect(visible[0].children[0].node.searchKey).toBe("kept")
  })

  it("returns empty visible and zero count for empty input", () => {
    const { visible, archivedCount } = partitionArchived([])
    expect(visible).toHaveLength(0)
    expect(archivedCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/src/__tests__/archive.test.ts`
Expected: FAIL — `archive.ts` doesn't exist yet.

- [ ] **Step 3: Implement `isArchived` and `partitionArchived`**

Create `packages/core/src/search/archive.ts`:

```ts
import type { ParsedNode } from "../graph/types.ts"
import type { ResultNode } from "./search.ts"

/** Check if a node has a `(meta-mdtree:: archive)` token. */
export function isArchived(node: ParsedNode): boolean {
  if (node.nodeType !== "text") return false
  return node.parsedTokens.some(
    t => t.tokenType === "meta_mdtree" && t.directive === "archive",
  )
}

/** Count a node plus all its descendants. */
function subtreeSize(node: ResultNode): number {
  let count = 1
  for (const child of node.children) count += subtreeSize(child)
  return count
}

/**
 * Split search results into visible nodes and a count of archived ones.
 * Archived nodes and their entire subtrees are removed from the visible set.
 */
export function partitionArchived(
  results: ResultNode[],
): { visible: ResultNode[]; archivedCount: number } {
  let archivedCount = 0
  const visible: ResultNode[] = []

  for (const node of results) {
    if (isArchived(node.node)) {
      archivedCount += subtreeSize(node)
      continue
    }

    const filtered = partitionArchived(node.children)
    archivedCount += filtered.archivedCount

    visible.push(
      filtered.archivedCount > 0
        ? { ...node, children: filtered.visible }
        : node,
    )
  }

  return { visible, archivedCount }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core/src/__tests__/archive.test.ts`
Expected: All 8 tests PASS.

- [ ] **Step 5: Export from core index**

In `packages/core/src/index.ts`, add after the `reverseMarkdownParsing` export (line 44):

```ts
export { isArchived, partitionArchived } from "./search/archive.ts"
```

- [ ] **Step 6: Run all core tests**

Run: `bun test packages/core/src/__tests__`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/search/archive.ts packages/core/src/__tests__/archive.test.ts packages/core/src/index.ts
git commit -m "feat(core): add isArchived and partitionArchived functions"
```

---

### Task 4: Add `meta_mdtree` case to copy.ts

**Files:**
- Modify: `packages/core/src/search/copy.ts:28-40`

- [ ] **Step 1: Add the `meta_mdtree` case**

In `packages/core/src/search/copy.ts`, in the `reverseMarkdown` function's switch statement (around line 38), add a new case before the closing brace. Currently the switch ends with:

```ts
    case "meta_action":
      return token.name + rest
  }
```

Change to:

```ts
    case "meta_action":
      return token.name + rest
    case "meta_mdtree":
      return `(meta-mdtree:: ${token.directive})` + rest
  }
```

- [ ] **Step 2: Run the build to check types**

Run: `bun run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/search/copy.ts
git commit -m "feat(core): preserve meta-mdtree annotation in reverse markdown"
```

---

### Task 5: Integration test with fixture

**Files:**
- Create: `packages/core/src/__tests__/integration/fixtures/archive/notes.md`
- Modify: `packages/core/src/__tests__/integration/integration.test.ts`

- [ ] **Step 1: Create the fixture file**

Create `packages/core/src/__tests__/integration/fixtures/archive/notes.md`:

```markdown
# Projects

## Active
- [[Alpha]]
  - task one
  - task two

## Done
- [[Beta]] (meta-mdtree:: archive)
  - completed task
    - subtask detail
- [[Gamma]]
  - still relevant
```

- [ ] **Step 2: Write the integration test**

Add to the end of `packages/core/src/__tests__/integration/integration.test.ts`:

```ts
// ── archive ───────────────────────────────────────────────────────────────────

describe("archive", () => {
  const g = loadFixture("archive")

  it("search returns archived nodes (search is unaware of archive)", () => {
    const keys = searchKeys(g, "projects")
    expect(keys.some(k => k.includes("beta"))).toBe(true)
    expect(keys.some(k => k.includes("completed task"))).toBe(true)
  })

  it("partitionArchived removes the archived subtree", () => {
    const results = search(g, "projects")
    const { visible, archivedCount } = partitionArchived(results)

    // Beta + completed task + subtask detail = 3 archived
    expect(archivedCount).toBe(3)

    // Flatten visible keys to check Beta is gone
    const visibleKeys = collectKeysFromResults(visible)
    expect(visibleKeys.some(k => k.includes("beta"))).toBe(false)
    expect(visibleKeys.some(k => k.includes("completed task"))).toBe(false)

    // Alpha and Gamma should still be visible
    expect(visibleKeys.some(k => k.includes("alpha"))).toBe(true)
    expect(visibleKeys.some(k => k.includes("gamma"))).toBe(true)
  })
})
```

Also update the imports at the top of the file. Currently:

```ts
import { describe, it, expect } from "bun:test"
import { loadFixture, search, searchKeys } from "./helpers.ts"
```

Change to:

```ts
import { describe, it, expect } from "bun:test"
import { loadFixture, search, searchKeys } from "./helpers.ts"
import { partitionArchived } from "../../search/archive.ts"
import type { ResultNode } from "../../search/search.ts"

function collectKeysFromResults(nodes: ResultNode[]): string[] {
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

- [ ] **Step 3: Run the integration tests**

Run: `bun test packages/core/src/__tests__/integration/integration.test.ts`
Expected: All tests PASS, including the two new `archive` tests.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/__tests__/integration/fixtures/archive/notes.md packages/core/src/__tests__/integration/integration.test.ts
git commit -m "test(core): add archive integration tests with fixture"
```

---

### Task 6: Wire `partitionArchived` into the plugin search pipeline

**Files:**
- Modify: `src/view/react-context/state.tsx:2,131-139`
- Modify: `src/view/raycast/raycast-server.ts:1-65`
- Modify: `src/view/markdown-code-block/InlineMarkdownResults.tsx:2,38-44`

- [ ] **Step 1: Update `state.tsx` — main search view**

In `src/view/react-context/state.tsx`:

Update the import on line 2. Currently:

```ts
import {advancedSearch, flattenTasks, ResultNode, searchIndex, searchParents, parseQuery, type QueryExpr} from '@mdtree/core'
```

Change to:

```ts
import {advancedSearch, flattenTasks, ResultNode, searchIndex, searchParents, parseQuery, type QueryExpr, partitionArchived} from '@mdtree/core'
```

Find the search molecule (around lines 131-139). Currently:

```ts
        const search = (isQuickLink && searchQuery.length > 0) ? `${searchQuery} . :page | :header` : searchQuery

        const searchResults = searchIndex(graph, search, separator)
        set(searchMol.updateSearchResultsAtom, searchResults)
```

Change to:

```ts
        const search = (isQuickLink && searchQuery.length > 0) ? `${searchQuery} . :page | :header` : searchQuery

        const searchResults = searchIndex(graph, search, separator)
        const { visible, archivedCount } = partitionArchived(searchResults)
        set(searchMol.updateSearchResultsAtom, visible, archivedCount)
```

Now update the `updateSearchResultsAtom` (around line 231). Currently:

```ts
    const updateSearchResultsAtom = atom(null, (get, set, result: ResultNode[]) => {
```

Change to:

```ts
    const updateSearchResultsAtom = atom(null, (get, set, result: ResultNode[], archivedCount = 0) => {
```

Then after line 263 (after `set(treeNodesAtom, nodesWithVisibility)`), add the synthetic archive node. Find:

```ts
        set(treeNodesAtom, nodesWithVisibility)
        set(selectedLineAtom, searchVisible ? 0 : -1)
```

Change to:

```ts
        // Append synthetic archive indicator if there are archived items
        if (archivedCount > 0) {
            const archiveIndicator: TreeNode = {
                node: {
                    nodeType: "text",
                    searchKey: `archive (${archivedCount} items)`,
                    location: { path: "", position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } } },
                    boost: -Infinity,
                    ageDays: 0,
                    parsedTokens: [{ tokenType: "text", text: `Archive (${archivedCount} items)`, decoration: "none" }],
                    tags: [],
                    isTask: false,
                    isCompleted: false,
                } as any,
                indent: 0,
                hasChildren: false,
                visible: true,
                selected: false,
                index: nodesWithVisibility.length,
            }
            nodesWithVisibility.push(archiveIndicator)
        }

        set(treeNodesAtom, nodesWithVisibility)
        set(selectedLineAtom, searchVisible ? 0 : -1)
```

Note: Remove the original `set(treeNodesAtom, nodesWithVisibility)` that was there before — the one above replaces it.

- [ ] **Step 2: Update `InlineMarkdownResults.tsx`**

In `src/view/markdown-code-block/InlineMarkdownResults.tsx`:

Update the import on line 2. Currently:

```ts
import {advancedSearch, ResultNode, searchIndex} from "@mdtree/core";
```

Change to:

```ts
import {advancedSearch, ResultNode, searchIndex, partitionArchived} from "@mdtree/core";
```

Update line 38. Currently:

```ts
            const searchResults = searchIndex(graph, `${settings.query} . ${query}`, separator)
            set(searchMol.updateSearchResultsAtom, searchResults)
```

Change to:

```ts
            const rawResults = searchIndex(graph, `${settings.query} . ${query}`, separator)
            const { visible, archivedCount } = partitionArchived(rawResults)
            set(searchMol.updateSearchResultsAtom, visible, archivedCount)
```

Also update lines 42-44 (the `advancedSearch` path). Currently:

```ts
            const searchResults = advancedSearch(graph, reference,
                `${settings.query} . ${query}`,
```

Find the line after this that calls `set(searchMol.updateSearchResultsAtom, searchResults)` and similarly partition those results. The exact line will be near line 44-45:

```ts
            const searchResults = advancedSearch(graph, reference,
                `${settings.query} . ${query}`,
                separator)
            set(searchMol.updateSearchResultsAtom, searchResults)
```

Change to:

```ts
            const rawResults = advancedSearch(graph, reference,
                `${settings.query} . ${query}`,
                separator)
            const { visible: advVisible, archivedCount: advArchived } = partitionArchived(rawResults)
            set(searchMol.updateSearchResultsAtom, advVisible, advArchived)
```

- [ ] **Step 3: Update `raycast-server.ts`**

In `src/view/raycast/raycast-server.ts`:

Update line 3. Currently:

```ts
import {searchIndex} from "@mdtree/core";
```

Change to:

```ts
import {searchIndex, partitionArchived} from "@mdtree/core";
```

Update lines 62-64. Currently:

```ts
            const result = searchIndex(graph, decodedQuery, separator);
            const flattened = flattenIndex(result)
            const mapped = createRaycastResponse(app, flattened.slice(0, limit))
```

Change to:

```ts
            const result = searchIndex(graph, decodedQuery, separator);
            const { visible } = partitionArchived(result)
            const flattened = flattenIndex(visible)
            const mapped = createRaycastResponse(app, flattened.slice(0, limit))
```

- [ ] **Step 4: Verify the build**

Run: `bun run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/view/react-context/state.tsx src/view/raycast/raycast-server.ts src/view/markdown-code-block/InlineMarkdownResults.tsx
git commit -m "feat(plugin): wire partitionArchived into all search pipelines"
```

---

### Task 7: Wire `partitionArchived` into CLI server and query command

**Files:**
- Modify: `packages/cli/src/server/response.ts:6-10`
- Modify: `packages/cli/src/server/server.ts:1,30-33`
- Modify: `packages/cli/src/commands/query.ts:1,30-42`

- [ ] **Step 1: Add `archivedCount` to `VaultResults` type**

In `packages/cli/src/server/response.ts`, update the `VaultResults` type (lines 6-10). Currently:

```ts
export type VaultResults = {
  vault: string
  results: IndividualListItemModel[]
  error?: string
}
```

Change to:

```ts
export type VaultResults = {
  vault: string
  results: IndividualListItemModel[]
  archivedCount?: number
  error?: string
}
```

Update `createVaultResults` (line 260). Currently:

```ts
export function createVaultResults(vault: string, results: TreeNode[]): VaultResults {
```

Change to:

```ts
export function createVaultResults(vault: string, results: TreeNode[], archivedCount = 0): VaultResults {
```

And update the return value (lines 261-274). Currently:

```ts
  return {
    vault,
    results: results.map((result, index) => {
```

Change to:

```ts
  return {
    vault,
    ...(archivedCount > 0 ? { archivedCount } : {}),
    results: results.map((result, index) => {
```

- [ ] **Step 2: Update CLI server**

In `packages/cli/src/server/server.ts`, update the import on line 1. Currently:

```ts
import { searchIndex, flattenIndex, type NotesGraph } from "@mdtree/core"
```

Change to:

```ts
import { searchIndex, flattenIndex, partitionArchived, type NotesGraph } from "@mdtree/core"
```

Update lines 30-32. Currently:

```ts
    const results = searchIndex(vault.graph, query, vault.settings.searchSeparator)
    const flattened = flattenIndex(results).slice(0, limit)
    const response = createVaultResults(vault.vaultName, flattened)
```

Change to:

```ts
    const results = searchIndex(vault.graph, query, vault.settings.searchSeparator)
    const { visible, archivedCount } = partitionArchived(results)
    const flattened = flattenIndex(visible).slice(0, limit)
    const response = createVaultResults(vault.vaultName, flattened, archivedCount)
```

- [ ] **Step 3: Update CLI query command**

In `packages/cli/src/commands/query.ts`, update the import on line 1. Currently:

```ts
import { resolve, basename } from "node:path"
import { DEFAULT_SETTINGS, NotesGraph, searchIndex, flattenIndex, reverseMarkdownParsing } from "@mdtree/core"
```

Change to:

```ts
import { resolve, basename } from "node:path"
import { DEFAULT_SETTINGS, NotesGraph, searchIndex, flattenIndex, reverseMarkdownParsing, partitionArchived } from "@mdtree/core"
```

Update the search/output section (around lines 30-42). Currently:

```ts
    const results = searchIndex(graph, opts.queryStr, DEFAULT_SETTINGS.searchSeparator)
    const flat = flattenIndex(results)
    allResults.push(...flat)
  }

  const limited = allResults.slice(0, opts.limit)

  if (opts.json) {
    process.stdout.write(JSON.stringify(limited, null, 2) + "\n")
  } else {
    for (const item of limited) {
      const indent = "  ".repeat(item.indent)
      const label = reverseMarkdownParsing(item.node)
      process.stdout.write(indent + label + "\n")
    }
  }
```

Change to:

```ts
    const results = searchIndex(graph, opts.queryStr, DEFAULT_SETTINGS.searchSeparator)
    const { visible, archivedCount: vaultArchived } = partitionArchived(results)
    const flat = flattenIndex(visible)
    allResults.push(...flat)
    totalArchived += vaultArchived
  }

  const limited = allResults.slice(0, opts.limit)

  if (opts.json) {
    const output = { results: limited, archivedCount: totalArchived }
    process.stdout.write(JSON.stringify(output, null, 2) + "\n")
  } else {
    for (const item of limited) {
      const indent = "  ".repeat(item.indent)
      const label = reverseMarkdownParsing(item.node)
      process.stdout.write(indent + label + "\n")
    }
    if (totalArchived > 0) {
      process.stdout.write(`Archive (${totalArchived} items)\n`)
    }
  }
```

Also add `let totalArchived = 0` before the `for (const dir of opts.dirs)` loop (around line 20). Find:

```ts
  const allResults: TreeNode[] = []

  for (const dir of opts.dirs) {
```

Change to:

```ts
  const allResults: TreeNode[] = []
  let totalArchived = 0

  for (const dir of opts.dirs) {
```

- [ ] **Step 4: Run CLI tests**

Run: `bun test packages/cli/src/__tests__/query.test.ts`
Expected: Tests PASS. (The JSON output format changed — the test checks for `parsed[0]` having `node` property. Since we now wrap in `{ results, archivedCount }`, the test will need updating.)

Note: The test on the JSON path checks `Array.isArray(parsed)` — this will now fail because the output is `{ results: [...], archivedCount: N }`. Update the test:

In `packages/cli/src/__tests__/query.test.ts`, find:

```ts
    const parsed = JSON.parse(output)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBeGreaterThan(0)
    expect(parsed[0]).toHaveProperty("node")
```

Change to:

```ts
    const parsed = JSON.parse(output)
    expect(parsed).toHaveProperty("results")
    expect(parsed).toHaveProperty("archivedCount")
    expect(Array.isArray(parsed.results)).toBe(true)
    expect(parsed.results.length).toBeGreaterThan(0)
    expect(parsed.results[0]).toHaveProperty("node")
```

- [ ] **Step 5: Run CLI tests again**

Run: `bun test packages/cli/src/__tests__/query.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/server/response.ts packages/cli/src/server/server.ts packages/cli/src/commands/query.ts packages/cli/src/__tests__/query.test.ts
git commit -m "feat(cli): wire partitionArchived into CLI server and query command"
```

---

### Task 8: Archive/Unarchive Raycast actions

**Files:**
- Modify: `src/view/node-actions.ts:103-151,230-301`
- Modify: `packages/cli/src/server/response.ts:202-256`

- [ ] **Step 1: Write the failing tests**

Add to the end of `src/view/__tests__/node-actions.test.ts`:

```ts
import type { TreeNode } from "../search/SearchViewFlatten"
import type { TextNode, ParsedTextToken } from "@mdtree/core"
import { getTreeNodeActions } from "../node-actions"

const loc = {
    path: "test.md",
    position: { start: { line: 5, ch: 0 }, end: { line: 5, ch: 20 } },
}

function makeTreeNode(parsedTokens: ParsedTextToken[]): TreeNode {
    const node: TextNode = {
        nodeType: "text",
        searchKey: "test item",
        location: loc,
        boost: 0,
        ageDays: 0,
        parsedTokens,
        tags: [],
        isTask: false,
        isCompleted: false,
    }
    return {
        node,
        indent: 0,
        hasChildren: false,
        visible: true,
        selected: false,
        index: 0,
    }
}

// Mock App with minimal vault.getName()
const mockApp = { vault: { getName: () => "TestVault", getFileByPath: () => null } } as any

describe("archive/unarchive actions", () => {
    it("shows Archive action for non-archived text node", () => {
        const treeNode = makeTreeNode([{ tokenType: "text", text: "item", decoration: "none" }])
        const actions = getTreeNodeActions(mockApp, treeNode)
        expect(actions.some(a => a.title === "Archive")).toBe(true)
        expect(actions.some(a => a.title === "Unarchive")).toBe(false)
    })

    it("shows Unarchive action for archived text node", () => {
        const treeNode = makeTreeNode([
            { tokenType: "text", text: "item", decoration: "none" },
            { tokenType: "meta_mdtree", directive: "archive" },
        ])
        const actions = getTreeNodeActions(mockApp, treeNode)
        expect(actions.some(a => a.title === "Unarchive")).toBe(true)
        expect(actions.some(a => a.title === "Archive")).toBe(false)
    })

    it("archive action URL contains raycastaction=archive", () => {
        const treeNode = makeTreeNode([{ tokenType: "text", text: "item", decoration: "none" }])
        const actions = getTreeNodeActions(mockApp, treeNode)
        const archiveAction = actions.find(a => a.title === "Archive")
        expect(archiveAction?.type).toBe("browse")
        if (archiveAction?.type === "browse") {
            expect(archiveAction.url).toContain("raycastaction=archive")
        }
    })

    it("unarchive action URL contains raycastaction=unarchive", () => {
        const treeNode = makeTreeNode([
            { tokenType: "text", text: "item", decoration: "none" },
            { tokenType: "meta_mdtree", directive: "archive" },
        ])
        const actions = getTreeNodeActions(mockApp, treeNode)
        const unarchiveAction = actions.find(a => a.title === "Unarchive")
        expect(unarchiveAction?.type).toBe("browse")
        if (unarchiveAction?.type === "browse") {
            expect(unarchiveAction.url).toContain("raycastaction=unarchive")
        }
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/view/__tests__/node-actions.test.ts`
Expected: FAIL — no Archive/Unarchive actions generated yet.

- [ ] **Step 3: Add archive URL builder and action logic to plugin `node-actions.ts`**

In `src/view/node-actions.ts`:

Add a new import at the top. After line 3:

```ts
import {ObsidianLinkToken, ParsedTextToken} from "@mdtree/core";
```

Add:

```ts
import {isArchived} from "@mdtree/core";
```

Add a new URL builder function after the `moveToFolder` function (after line 217):

```ts
function archiveUrl(location: TreeNode["node"]["location"], vault: string): string {
    const uri = `raycastaction=archive&vault=${vault}&filepath=${location.path}&sl=${location.position.start.line}&sc=${location.position.start.ch}&el=${location.position.end.line}&ec=${location.position.end.ch}`;
    return `obsidian://tree-search-uri?${encodeURI(uri)}`;
}

function unarchiveUrl(location: TreeNode["node"]["location"], vault: string): string {
    const uri = `raycastaction=unarchive&vault=${vault}&filepath=${location.path}&sl=${location.position.start.line}&sc=${location.position.start.ch}&el=${location.position.end.line}&ec=${location.position.end.ch}`;
    return `obsidian://tree-search-uri?${encodeURI(uri)}`;
}
```

In the `getDefaultActions` function, add the archive/unarchive action after the `moveFolderAction` block. Find the return statement (around line 150):

```ts
    return [...defaults, ...moveFolderAction]
```

Change to:

```ts
    // Archive / Unarchive action for text nodes
    const archiveAction: RaycastAction[] = result.node.nodeType === "text"
        ? isArchived(result.node)
            ? [{
                type: "browse",
                url: unarchiveUrl(result.node.location, vault),
                title: "Unarchive",
                icon: Icons.bookmark,
            }]
            : [{
                type: "browse",
                url: archiveUrl(result.node.location, vault),
                title: "Archive",
                icon: Icons.bookmark,
            }]
        : []

    return [...defaults, ...moveFolderAction, ...archiveAction]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/view/__tests__/node-actions.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Add archive actions to CLI server response**

In `packages/cli/src/server/response.ts`:

Add the import. At line 1, currently:

```ts
import type { TreeNode, ParsedTextToken, ObsidianLinkToken } from "@mdtree/core"
import { reverseMarkdownParsing } from "@mdtree/core"
```

Change to:

```ts
import type { TreeNode, ParsedTextToken, ObsidianLinkToken } from "@mdtree/core"
import { reverseMarkdownParsing, isArchived } from "@mdtree/core"
```

Add URL builder functions after the `obsidianUri` function (after line 71):

```ts
function archiveUrl(location: TreeNode["node"]["location"], vault: string): string {
  const { path, position } = location
  return obsidianUri(
    `raycastaction=archive&vault=${vault}&filepath=${path}&sl=${position.start.line}&sc=${position.start.ch}&el=${position.end.line}&ec=${position.end.ch}`,
  )
}

function unarchiveUrl(location: TreeNode["node"]["location"], vault: string): string {
  const { path, position } = location
  return obsidianUri(
    `raycastaction=unarchive&vault=${vault}&filepath=${path}&sl=${position.start.line}&sc=${position.start.ch}&el=${position.end.line}&ec=${position.end.ch}`,
  )
}
```

In the `defaultActions` function, add the archive action. Find the return at the end (around line 255):

```ts
  return base
```

Change to:

```ts
  // Archive / Unarchive for text nodes
  if (node.nodeType === "text") {
    base.push(
      isArchived(node)
        ? {
            type: "browse",
            url: unarchiveUrl(node.location, vault),
            title: "Unarchive",
            icon: Icons.blankDocument,
          }
        : {
            type: "browse",
            url: archiveUrl(node.location, vault),
            title: "Archive",
            icon: Icons.blankDocument,
          },
    )
  }

  return base
```

- [ ] **Step 6: Add `meta_mdtree` case to both nodeRenderer functions**

In `src/view/node-actions.ts`, in the `nodeRenderer` function (around line 291), after the `meta_action` case:

```ts
        case "meta_action":
            actions.push({
                type: "browse",
                url: token.url,
                title: truncateActionTitle(token.name),
                icon: token.icon ?? Icons.globe
            });
            return nodeRenderer(tokens.slice(1), actions, vault);
```

Add:

```ts
        case "meta_mdtree":
            return nodeRenderer(tokens.slice(1), actions, vault);
```

In `packages/cli/src/server/response.ts`, in its `nodeRenderer` function (around line 196), after the `meta_action` case:

```ts
    case "meta_action": {
      actions.push({
        type: "browse",
        url: token.url,
        title: truncate(token.name),
        icon: token.icon ?? Icons.globe,
      })
      return nodeRenderer(tokens.slice(1), actions, vault)
    }
```

Add:

```ts
    case "meta_mdtree":
      return nodeRenderer(tokens.slice(1), actions, vault)
```

- [ ] **Step 7: Run the build**

Run: `bun run build`
Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/view/node-actions.ts src/view/__tests__/node-actions.test.ts packages/cli/src/server/response.ts
git commit -m "feat: add Archive/Unarchive Raycast actions for text nodes"
```

---

### Task 9: Handle `archive`/`unarchive` URI actions in the Obsidian plugin

**Files:**
- Modify: `src/main.ts:132-153`
- Modify: `src/obsidian-utils.ts` (add new functions)

- [ ] **Step 1: Add file modification helpers to `obsidian-utils.ts`**

In `src/obsidian-utils.ts`, add two new exported functions at the end of the file:

```ts
export async function archiveLine(app: App, loc: Location) {
    const file = app.vault.getFileByPath(loc.path)
    if (!file) return

    const content = await app.vault.read(file)
    const lines = content.split("\n")
    const lineIdx = loc.position.start.line

    if (lineIdx >= lines.length) return

    // Append the archive annotation before any trailing whitespace
    lines[lineIdx] = lines[lineIdx].trimEnd() + " (meta-mdtree:: archive)"
    await app.vault.modify(file, lines.join("\n"))
}

export async function unarchiveLine(app: App, loc: Location) {
    const file = app.vault.getFileByPath(loc.path)
    if (!file) return

    const content = await app.vault.read(file)
    const lines = content.split("\n")
    const lineIdx = loc.position.start.line

    if (lineIdx >= lines.length) return

    // Remove the archive annotation and trim trailing whitespace
    lines[lineIdx] = lines[lineIdx].replace(/\s*\(meta-mdtree::\s*archive\)/, "").trimEnd()
    await app.vault.modify(file, lines.join("\n"))
}
```

- [ ] **Step 2: Handle the new URI actions in `main.ts`**

In `src/main.ts`, update the URI handler (around lines 142-152). Currently:

```ts
            if (uri.raycastaction === "insert") {
                await insertLine(this.app, location)
            } else if (uri.raycastaction == "revealFolder") {
                await showFolder(this.app, uri.filepath)
            } if (uri.raycastaction == "open") {
                await openFileByName(this.app, uri.filepath + (uri.hash ? `#${uri.hash}` : ""))
            } else if (uri.raycastaction == "moveToFolder") {
                moveToFolder(this.app, uri.filepath)
            } else {
                await highlightLine(this.app, location)
            }
```

Add imports at the top of `main.ts`. Find the import from `obsidian-utils` and add `archiveLine, unarchiveLine`:

```ts
import {highlightLine, insertLine, openFileByName, showFolder, moveToFolder, archiveLine, unarchiveLine} from "./obsidian-utils";
```

Change the handler chain to:

```ts
            if (uri.raycastaction === "insert") {
                await insertLine(this.app, location)
            } else if (uri.raycastaction === "revealFolder") {
                await showFolder(this.app, uri.filepath)
            } else if (uri.raycastaction === "open") {
                await openFileByName(this.app, uri.filepath + (uri.hash ? `#${uri.hash}` : ""))
            } else if (uri.raycastaction === "moveToFolder") {
                moveToFolder(this.app, uri.filepath)
            } else if (uri.raycastaction === "archive") {
                await archiveLine(this.app, location)
            } else if (uri.raycastaction === "unarchive") {
                await unarchiveLine(this.app, location)
            } else {
                await highlightLine(this.app, location)
            }
```

- [ ] **Step 3: Verify the build**

Run: `bun run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/obsidian-utils.ts src/main.ts
git commit -m "feat(plugin): handle archive/unarchive URI actions"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run all core tests**

Run: `bun test packages/core/src/__tests__`
Expected: All tests PASS.

- [ ] **Step 2: Run all CLI tests**

Run: `bun test packages/cli/src/__tests__`
Expected: All tests PASS.

- [ ] **Step 3: Run plugin tests**

Run: `bun test src/view/__tests__`
Expected: All tests PASS.

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All tests PASS.

- [ ] **Step 5: Run full build**

Run: `bun run build`
Expected: Build succeeds with no errors.

- [ ] **Step 6: Verify all tests pass together**

Run: `bun run mdtree:test`
Expected: All tests PASS.
