# Pull and Organise Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename "Pull children into this note" to "Pull and organise notes" and rework its write model so every topic reached during a pull is filed into its own note (real file, or auto-created) instead of everything flattening into the note you started from, with a rendered/clickable preview pane replacing the transient modal.

**Architecture:** `packages/core/src/search/pull.ts` gains a home-aware write planner (`planOrganiseWrites`) that replaces the destination-scoped `planPullWrites`; a new pure module (`organise-sections.ts`) owns marker-bounded section text manipulation; `src/obsidian-utils.ts` gains `resolveHome` (decides a topic's file) and `applyOrganisePlan` (writes sections + runs deletions) replacing `applyPullPlan`; the view layer moves from `src/view/pull-children/` (a `Modal`) to `src/view/organise-notes/` (a persistent `ItemView`, `OrganiseView`, hosting an updated `PullTreeView` that renders real markdown/wikilinks).

**Tech Stack:** TypeScript, Bun test, React 18, Obsidian Plugin API (`ItemView`, `MarkdownRenderer`, `Component`), jotai (existing global store, used only for reading `graphAtom`/`appAtom`, no new atoms).

**Design doc:** `docs/superpowers/specs/2026-08-27-pull-and-organise-notes-design.md`

---

## Reference: spec-to-task coverage

| Spec section | Task(s) |
|---|---|
| §1 Naming & entry points | 9, 10 |
| §2 Data model changes | 1, 2 |
| §3 File writing (marker sections) | 3, 4, 6 |
| §4 Rendering | 7 |
| §5 Pane | 8, 9 |
| §6 Naming | 9, 10 |
| Migration Plan (openspec supersession) | 12 |

---

### Task 1: `planOrganiseWrites` replaces `planPullWrites` in `packages/core/src/search/pull.ts`

**Files:**
- Modify: `packages/core/src/search/pull.ts`
- Test: `packages/core/src/__tests__/pull.test.ts`

Removes `PullWriteAnchor`, `PullWrite`, `planPullWrites`, and `findExistingOccurrence` (all superseded — home resolution replaces destination-scoped merge detection). Adds `OrganiseHome` and `SectionWrite` types and `planOrganiseWrites`. `buildPullTree`, `formatOccurrenceDate`, `PullLine`, `PullDeletion`, `planDeletions`, and `isSafeToDeleteSource` are unchanged.

- [ ] **Step 1: Write the failing tests**

Open `packages/core/src/__tests__/pull.test.ts`. Remove the `findExistingOccurrence` describe block (lines with `describe("findExistingOccurrence", ...)` near the bottom of the file) and its three `it` cases — that function no longer exists.

In the `import` block at the top, replace:

```typescript
import {
  buildPullTree,
  formatOccurrenceDate,
  findExistingOccurrence,
  planPullWrites,
  planDeletions,
  type PullNode,
} from "../search/pull.ts"
```

with:

```typescript
import {
  buildPullTree,
  formatOccurrenceDate,
  planOrganiseWrites,
  planDeletions,
  type PullNode,
  type OrganiseHome,
} from "../search/pull.ts"
```

In the `"Pull children - end-to-end example"` describe block, replace the three tests that call `planPullWrites` — `"renders a fresh pull verbatim, with a date on each mention line and none on the [[Child]] header"`, `"merges under an existing occurrence instead of duplicating it"`, and `"excludes an unchecked node and its descendants from the write plan"` — with:

```typescript
  it("routes the root's direct page-children into the root's own home, as a bare link with no attached date", () => {
    const g = freshGraph()
    const tree = buildPullTree(g, "[[parent]]")!
    const rootHome: OrganiseHome = { path: "Organising.md", exists: true }
    const resolveHome = (key: string): OrganiseHome => ({ path: `home-for-${key}`, exists: false })

    const writes = planOrganiseWrites(tree, rootHome, checkAll, resolveHome)

    const rootWrite = writes.find(w => w.home.path === "Organising.md")!
    expect(rootWrite.children).toEqual([{ depth: 0, text: "[[Child]]" }])
    expect(rootWrite.mentions).toEqual([])
  })

  it("routes a page-child's own text-mentions into that child's resolved home, not the root's", () => {
    const g = freshGraph()
    const tree = buildPullTree(g, "[[parent]]")!
    const rootHome: OrganiseHome = { path: "Organising.md", exists: true }
    const resolveHome = (key: string): OrganiseHome =>
      key === "[[child]]" ? { path: "Child.md", exists: false } : { path: "Organising.md", exists: true }

    const writes = planOrganiseWrites(tree, rootHome, checkAll, resolveHome)

    const childWrite = writes.find(w => w.home.path === "Child.md")!
    expect(childWrite.children).toEqual([])
    expect(childWrite.mentions.map(l => l.text)).toEqual([
      "[[Child]] [http://test-url](http://test-url) 2025-03-22",
      "[[Child]] test note without url 2025-03-22",
    ])

    const rootWrite = writes.find(w => w.home.path === "Organising.md")!
    expect(rootWrite.mentions).toEqual([])
  })

  it("never resolves a home for a checked page-child that ends up with no checked descendants of its own", () => {
    const g = freshGraph()
    const tree = buildPullTree(g, "[[parent]]")!
    const childKey = tree.children[0].key // "[[child]]"
    const resolveHomeCalls: string[] = []
    const resolveHome = (key: string): OrganiseHome => {
      resolveHomeCalls.push(key)
      return { path: key, exists: false }
    }
    // Only [[Child]] itself is checked - none of its own mention children are.
    const isChecked = (key: string) => key === childKey

    const writes = planOrganiseWrites(tree, { path: "Organising.md", exists: true }, isChecked, resolveHome)

    expect(resolveHomeCalls).toEqual([])
    expect(writes).toHaveLength(1)
    expect(writes[0].home.path).toBe("Organising.md")
    expect(writes[0].children).toEqual([{ depth: 0, text: "[[Child]]" }])
  })

  it("omits a home from the result entirely when nothing is checked", () => {
    const g = freshGraph()
    const tree = buildPullTree(g, "[[parent]]")!
    const writes = planOrganiseWrites(
      tree,
      { path: "Organising.md", exists: true },
      () => false,
      () => ({ path: "unused", exists: false }),
    )
    expect(writes).toEqual([])
  })
```

Leave `"deletes fully-consumed source lines when everything is checked"` and `"does not delete a line whose child was left unchecked"` exactly as they are — they call `planDeletions`, which isn't changing.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/src/__tests__/pull.test.ts`
Expected: FAIL — `planOrganiseWrites is not a function` / `findExistingOccurrence` import errors, since the source file hasn't changed yet.

- [ ] **Step 3: Implement `planOrganiseWrites`, remove the superseded exports**

In `packages/core/src/search/pull.ts`, delete the entire `// ── Merge detection ──` section (the `findExistingOccurrence` function and its docstring, lines 102-119 in the current file) and the entire `// ── Write plan ──` section (`PullLine` stays, but `PullWriteAnchor`, `PullWrite`, and `planPullWrites` — lines 121-175 in the current file, keeping the `export type PullLine = { depth: number; text: string }` line) — replace that whole block with:

```typescript
// ── Write plan ────────────────────────────────────────────────────────────────

export type PullLine = { depth: number; text: string }

/** A topic's resolved destination note. `exists: false` means the caller
 * (which owns `app.vault`) still needs to create it before writing. */
export type OrganiseHome = { path: string; exists: boolean }

/** Everything to write into one home: its new direct-topic links (bare,
 * undated - `depth` is always 0, kept only so `PullLine` stays one shared
 * shape) and its new text mentions (verbatim line + date, as before). */
export type SectionWrite = { home: OrganiseHome; children: PullLine[]; mentions: PullLine[] }

/**
 * Plans where every checked node in `root` ends up, organised by topic
 * rather than flattened into wherever the pull was started. `root`'s own
 * checked children go to `rootHome` (the note you're organising from -
 * always exists, never auto-created). From there, every checked **page**
 * child is (a) added as a bare link line to the *current* anchor's
 * `children` list, and (b) recursed into using *its own* resolved home
 * (`resolveHome(child.key)`) as the new anchor for its descendants - this is
 * what routes a topic's own detail lines into its own note even when the
 * pull started somewhere else. Every checked **text** child (a mention) is
 * added to the current anchor's `mentions` list and recursed into using the
 * *same* anchor (a mention's own sub-lines, if any, still belong to whatever
 * topic the mention itself belongs to).
 *
 * `resolveHome` is only ever called for a page-child that has at least one
 * checked child of its own - a checked leaf topic with nothing beneath it
 * never gets a home computed (and so never causes a new file to be created)
 * for content it wouldn't actually receive.
 */
export function planOrganiseWrites(
  root: PullNode,
  rootHome: OrganiseHome,
  isChecked: (key: string) => boolean,
  resolveHome: (pageKey: string) => OrganiseHome,
): SectionWrite[] {
  const byHomePath = new Map<string, SectionWrite>()

  function ensureWrite(home: OrganiseHome): SectionWrite {
    const existing = byHomePath.get(home.path)
    if (existing) return existing
    const created: SectionWrite = { home, children: [], mentions: [] }
    byHomePath.set(home.path, created)
    return created
  }

  function visit(node: PullNode, homeThunk: () => OrganiseHome): void {
    for (const child of node.children) {
      if (!isChecked(child.key)) continue

      if (child.node.nodeType === "page") {
        const write = ensureWrite(homeThunk())
        write.children.push({ depth: 0, text: reverseMarkdownParsing(child.node) })

        let childHome: OrganiseHome | null = null
        visit(child, () => childHome ?? (childHome = resolveHome(child.key)))
      } else {
        const write = ensureWrite(homeThunk())
        const date = formatOccurrenceDate(child.node)
        write.mentions.push({ depth: 0, text: reverseMarkdownParsing(child.node) + (date ? ` ${date}` : "") })

        visit(child, homeThunk)
      }
    }
  }

  visit(root, () => rootHome)
  return Array.from(byHomePath.values())
}
```

`Location` stays imported (still used by `PullDeletion`). No changes needed to the import block at the top of the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core/src/__tests__/pull.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/search/pull.ts packages/core/src/__tests__/pull.test.ts
git commit -m "feat(pull): route organised content to each topic's own home"
```

---

### Task 2: Update `packages/core/src/index.ts` exports

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Update the export block**

Replace:

```typescript
export {
  buildPullTree,
  formatOccurrenceDate,
  findExistingOccurrence,
  planPullWrites,
  planDeletions,
  type PullNode,
  type PullLine,
  type PullWriteAnchor,
  type PullWrite,
  type PullDeletion,
} from "./search/pull.ts"
```

with:

```typescript
export {
  buildPullTree,
  formatOccurrenceDate,
  planOrganiseWrites,
  planDeletions,
  type PullNode,
  type PullLine,
  type OrganiseHome,
  type SectionWrite,
  type PullDeletion,
} from "./search/pull.ts"
```

- [ ] **Step 2: Verify the whole workspace still type-checks**

Run: `node_modules/.bin/tsc -noEmit -skipLibCheck`
Expected: Errors in `src/obsidian-utils.ts`, `src/view/pull-children/*`, and `src/main.ts` (they still reference the old exports) — that's expected at this point in the plan; confirm there are **no** errors inside `packages/core/`.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(pull): export planOrganiseWrites/OrganiseHome/SectionWrite from @mdtree/core"
```

---

### Task 3: Pure marker-section upsert logic (`organise-sections.ts`)

**Files:**
- Create: `packages/core/src/search/organise-sections.ts`
- Create: `packages/core/src/__tests__/organise-sections.test.ts`

This is the pure text-manipulation core of "maintain two idempotent sections at the top of a note" — no Obsidian API involved, fully unit-testable.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/__tests__/organise-sections.test.ts`:

```typescript
import { describe, it, expect } from "bun:test"
import { upsertOrganiseSections } from "../search/organise-sections.ts"

describe("upsertOrganiseSections", () => {
  it("creates both sections fresh at the top of a note with no frontmatter", () => {
    const content = "# My Note\nSome existing content"
    const result = upsertOrganiseSections(content, ["- [[Child]]"], ["- [[Parent]] a mention"])

    expect(result).toBe(
      "<!-- organise:children -->\n" +
      "- [[Child]]\n" +
      "<!-- /organise:children -->\n" +
      "\n" +
      "<!-- organise:mentions -->\n" +
      "- [[Parent]] a mention\n" +
      "<!-- /organise:mentions -->\n" +
      "\n" +
      "# My Note\n" +
      "Some existing content"
    )
  })

  it("inserts fresh sections after frontmatter when present", () => {
    const content = "---\ntags: [x]\n---\n# My Note"
    const result = upsertOrganiseSections(content, ["- [[Child]]"], [])

    expect(result).toBe(
      "---\n" +
      "tags: [x]\n" +
      "---\n" +
      "<!-- organise:children -->\n" +
      "- [[Child]]\n" +
      "<!-- /organise:children -->\n" +
      "\n" +
      "<!-- organise:mentions -->\n" +
      "<!-- /organise:mentions -->\n" +
      "\n" +
      "# My Note"
    )
  })

  it("keeps empty markers rather than omitting them when a section has no lines", () => {
    const result = upsertOrganiseSections("body", [], [])
    expect(result).toContain("<!-- organise:children -->\n<!-- /organise:children -->")
    expect(result).toContain("<!-- organise:mentions -->\n<!-- /organise:mentions -->")
  })

  it("updates an existing children section in place without touching mentions or the rest of the note", () => {
    const existing =
      "<!-- organise:children -->\n" +
      "- [[Child]]\n" +
      "<!-- /organise:children -->\n" +
      "\n" +
      "<!-- organise:mentions -->\n" +
      "- [[Parent]] old mention\n" +
      "<!-- /organise:mentions -->\n" +
      "\n" +
      "# Rest of note\n" +
      "unchanged"

    const result = upsertOrganiseSections(existing, ["- [[Child]]", "- [[Child2]]"], [])

    expect(result).toBe(
      "<!-- organise:children -->\n" +
      "- [[Child]]\n" +
      "- [[Child2]]\n" +
      "<!-- /organise:children -->\n" +
      "\n" +
      "<!-- organise:mentions -->\n" +
      "- [[Parent]] old mention\n" +
      "<!-- /organise:mentions -->\n" +
      "\n" +
      "# Rest of note\n" +
      "unchanged"
    )
  })

  it("does not duplicate a line that's already present in the section", () => {
    const existing =
      "<!-- organise:children -->\n" +
      "- [[Child]]\n" +
      "<!-- /organise:children -->\n" +
      "\n" +
      "<!-- organise:mentions -->\n" +
      "<!-- /organise:mentions -->\n"

    const result = upsertOrganiseSections(existing, ["- [[Child]]"], [])
    const childrenBody = result.split("<!-- organise:children -->\n")[1].split("\n<!-- /organise:children -->")[0]
    expect(childrenBody).toBe("- [[Child]]")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/src/__tests__/organise-sections.test.ts`
Expected: FAIL — `Cannot find module '../search/organise-sections.ts'`.

- [ ] **Step 3: Implement `organise-sections.ts`**

Create `packages/core/src/search/organise-sections.ts`:

```typescript
// ── Marker-bounded section upsert ───────────────────────────────────────────────
//
// Every note "Pull and organise notes" writes into gets two fixed, hidden-
// marker-bounded regions at its top (after frontmatter if present): a flat
// list of bare topic links, and a flat list of text mentions referencing
// that note. Re-running the organise action must update these regions
// in place rather than duplicating them - that idempotency is this module's
// entire job. Nothing here touches the filesystem; the caller (obsidian-
// utils.ts, which owns `app.vault`) reads/writes the file and passes plain
// strings through.

type SectionMarker = "children" | "mentions"

function markerTags(marker: SectionMarker): { open: string; close: string } {
  return { open: `<!-- organise:${marker} -->`, close: `<!-- /organise:${marker} -->` }
}

/** End of a leading `---\n...\n---` frontmatter block, or 0 if there is none. */
function frontmatterEnd(lines: string[]): number {
  if (lines[0] !== "---") return 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") return i + 1
  }
  return 0
}

/**
 * Replaces one marker pair's body in place, deduping `newLines` against
 * whatever the section already contains (exact line match). Returns `null`
 * if the marker pair isn't found (caller falls back to creating it).
 */
function replaceSectionBody(lines: string[], marker: SectionMarker, newLines: string[]): string[] | null {
  const { open, close } = markerTags(marker)
  const openIdx = lines.indexOf(open)
  if (openIdx === -1) return null
  const closeIdx = lines.indexOf(close, openIdx + 1)
  if (closeIdx === -1) return null

  const existing = lines.slice(openIdx + 1, closeIdx)
  const merged = [...existing]
  for (const line of newLines) {
    if (!merged.includes(line)) merged.push(line)
  }
  return [...lines.slice(0, openIdx + 1), ...merged, ...lines.slice(closeIdx)]
}

/**
 * Upserts both managed sections (children, then mentions, in that fixed
 * order) into a note's content. `childrenLines`/`mentionsLines` are already
 * fully rendered bullet lines (e.g. `"- [[Child]]"`). If both marker pairs
 * already exist, each is updated independently and in place. If either is
 * missing (first run, or a manually-stripped marker), both are (re)created
 * together as one fresh block right after frontmatter - this deliberately
 * does not try to preserve a partially-existing lone section's content in
 * that rare case; see the design doc's noted risk on hand-edited regions.
 */
export function upsertOrganiseSections(content: string, childrenLines: string[], mentionsLines: string[]): string {
  const original = content.split("\n")

  const childrenReplaced = replaceSectionBody(original, "children", childrenLines)
  const mentionsReplaced = replaceSectionBody(original, "mentions", mentionsLines)

  if (childrenReplaced && mentionsReplaced) {
    return replaceSectionBody(childrenReplaced, "mentions", mentionsLines)!.join("\n")
  }

  const insertAt = frontmatterEnd(original)
  const { open: childrenOpen, close: childrenClose } = markerTags("children")
  const { open: mentionsOpen, close: mentionsClose } = markerTags("mentions")
  const block = [
    childrenOpen, ...childrenLines, childrenClose, "",
    mentionsOpen, ...mentionsLines, mentionsClose, "",
  ]
  return [...original.slice(0, insertAt), ...block, ...original.slice(insertAt)].join("\n")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core/src/__tests__/organise-sections.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/search/organise-sections.ts packages/core/src/__tests__/organise-sections.test.ts
git commit -m "feat(pull): add pure marker-section upsert logic for organised notes"
```

---

### Task 4: Export `upsertOrganiseSections` from `packages/core/src/index.ts`

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add the export**

In `packages/core/src/index.ts`, immediately after the `pull.ts` export block added in Task 2, add:

```typescript
export { upsertOrganiseSections } from "./search/organise-sections.ts"
```

- [ ] **Step 2: Verify**

Run: `bun test packages/core`
Expected: PASS, all `packages/core` tests green (same count as before plus the 5 new `organise-sections` tests plus the 4 new `pull.ts` tests, minus the 3 removed `planPullWrites` tests and 3 removed `findExistingOccurrence` tests).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(pull): export upsertOrganiseSections from @mdtree/core"
```

---

### Task 5: `resolveHome` in `src/obsidian-utils.ts`

**Files:**
- Modify: `src/obsidian-utils.ts`
- Test: `src/__tests__/organise-home.test.ts` (new — first test file for `obsidian-utils.ts`; only feasible because `resolveHome` touches nothing but `app.vault.getFileByPath`, which is trivial to fake)

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/organise-home.test.ts`:

```typescript
import { describe, it, expect } from "bun:test"
import { NotesGraph, type PageNode } from "@mdtree/core"
import { resolveHome } from "../obsidian-utils"

function makePage(name: string, path: string, isReference: boolean): PageNode {
  return {
    nodeType: "page",
    isReference,
    page: name,
    aliases: [],
    tags: [],
    location: { path, position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } } },
    searchKey: name.toLowerCase(),
    boost: 1,
    ageDays: 0,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeApp(existingPaths: string[]): any {
  return {
    vault: {
      getFileByPath: (path: string) => (existingPaths.includes(path) ? { path } : null),
    },
  }
}

describe("resolveHome", () => {
  it("uses a real page's own file as its home", () => {
    const g = new NotesGraph()
    g.addOrUpdateNode(makePage("Child", "Notes/Child.md", false))

    const home = resolveHome(fakeApp([]), g, "[[child]]", "Notes/Parent.md")

    expect(home).toEqual({ path: "Notes/Child.md", exists: true })
  })

  it("computes a same-folder candidate for a virtual reference with no file yet", () => {
    const g = new NotesGraph()
    g.addOrUpdateNode(makePage("Child", "Daily/2025-03-20.md", true))

    const home = resolveHome(fakeApp([]), g, "[[child]]", "Notes/Parent.md")

    expect(home).toEqual({ path: "Notes/Child.md", exists: false })
  })

  it("marks exists:true when a file already sits at the candidate path", () => {
    const g = new NotesGraph()
    g.addOrUpdateNode(makePage("Child", "Daily/2025-03-20.md", true))

    const home = resolveHome(fakeApp(["Notes/Child.md"]), g, "[[child]]", "Notes/Parent.md")

    expect(home).toEqual({ path: "Notes/Child.md", exists: true })
  })

  it("uses the vault root when the organising note has no folder", () => {
    const g = new NotesGraph()
    g.addOrUpdateNode(makePage("Child", "Daily.md", true))

    const home = resolveHome(fakeApp([]), g, "[[child]]", "Parent.md")

    expect(home).toEqual({ path: "Child.md", exists: false })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/__tests__/organise-home.test.ts`
Expected: FAIL — `resolveHome` is not exported from `../obsidian-utils`.

- [ ] **Step 3: Implement `resolveHome`**

In `src/obsidian-utils.ts`, update the `@mdtree/core` import at the top. It currently reads `import {Location, PullWrite, PullDeletion} from "@mdtree/core";` — `PullWrite` no longer exists as of Task 2 (this line has been a type error since then, as noted in Task 2's step 2; that's expected and gets fixed here). Replace it with:

```typescript
import {Location, PullDeletion, PageNode} from "@mdtree/core";
import type {NotesGraph, OrganiseHome} from "@mdtree/core";
```

(`SectionWrite` and `upsertOrganiseSections` are added to this same import in Task 6, once `applyOrganisePlan` needs them — not yet, in this step.)

Then, in the `// ── Pull children ──` section (just above `const INDENT_UNIT = "  "`), add:

```typescript
/**
 * A topic's home note: its own real file if it has one, otherwise a
 * same-folder-as-the-organising-note candidate path (which may or may not
 * exist yet - `exists` tells the caller whether to create it). `pageKey`
 * must name a "page" node; callers only ever call this for page-type
 * children of the pull tree.
 */
export function resolveHome(app: App, graph: NotesGraph, pageKey: string, organisingNotePath: string): OrganiseHome {
  const node = graph.getNodeAttributes(pageKey) as PageNode
  if (!node.isReference) return { path: node.location.path, exists: true }

  const slash = organisingNotePath.lastIndexOf("/")
  const folder = slash === -1 ? "" : organisingNotePath.slice(0, slash)
  const candidatePath = folder ? `${folder}/${node.page}.md` : `${node.page}.md`
  return { path: candidatePath, exists: app.vault.getFileByPath(candidatePath) != null }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/__tests__/organise-home.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/obsidian-utils.ts src/__tests__/organise-home.test.ts
git commit -m "feat(pull): resolve each topic's own home note"
```

---

### Task 6: Replace `applyPullPlan` with `applyOrganisePlan`

**Files:**
- Modify: `src/obsidian-utils.ts`

No dedicated test — matches this file's existing convention (zero prior test coverage on anything that touches `app.vault.modify`/`create`/`read`); verified via `tsc` plus the full-suite run at the end of this plan, and the manual smoke-test checklist in Task 11.

- [ ] **Step 1: Remove the superseded code, add the new function**

In `src/obsidian-utils.ts`, replace the entire `// ── Pull children ──` section — from `const INDENT_UNIT = "  "` through the end of `applyPullPlan` (i.e. everything Task 5 didn't already touch: `leadingWhitespace`, `renderPullLines`, `findInsertionPointAfterChildren`, `PendingOp`, `ResolvedOp`, and `applyPullPlan` itself) — with:

```typescript
/**
 * Applies an organise plan to the vault: for each `SectionWrite`, creates
 * its home file first if it doesn't exist yet, then upserts its two managed
 * sections (see `upsertOrganiseSections`); then applies every deletion.
 * Per file, deletions are applied first, against the file's original
 * content and in descending line-number order, so multiple deletions in the
 * same file never invalidate each other's line numbers - and so that a
 * subsequent section upsert (which is marker/text based, not line-number
 * based) is never thrown off by lines the deletions already removed above
 * it. A file that receives both a section write and deletions is only read
 * and written once.
 */
export async function applyOrganisePlan(app: App, writes: SectionWrite[], deletions: PullDeletion[]): Promise<void> {
  const deletionsByPath = new Map<string, PullDeletion[]>()
  for (const deletion of deletions) {
    if (!deletionsByPath.has(deletion.location.path)) deletionsByPath.set(deletion.location.path, [])
    deletionsByPath.get(deletion.location.path)!.push(deletion)
  }

  const writesByPath = new Map<string, SectionWrite>()
  for (const write of writes) {
    if (write.children.length === 0 && write.mentions.length === 0) continue
    writesByPath.set(write.home.path, write)
  }

  const touchedPaths = new Set<string>([...deletionsByPath.keys(), ...writesByPath.keys()])

  for (const path of touchedPaths) {
    const write = writesByPath.get(path)

    let file = app.vault.getFileByPath(path)
    if (!file && write && !write.home.exists) {
      file = await app.vault.create(path, "")
    }
    if (!file) continue

    const lines = (await app.vault.read(file)).split("\n")

    const dels = deletionsByPath.get(path)
    if (dels) {
      const sorted = [...dels].sort((a, b) => b.location.position.start.line - a.location.position.start.line)
      for (const deletion of sorted) lines.splice(deletion.location.position.start.line, 1)
    }

    let content = lines.join("\n")
    if (write) {
      content = upsertOrganiseSections(
        content,
        write.children.map(l => `- ${l.text}`),
        write.mentions.map(l => `- ${l.text}`),
      )
    }

    await app.vault.modify(file, content)
  }
}
```

Update the `@mdtree/core` imports at the top of the file (Task 5 left them as `import {Location, PullDeletion, PageNode} from "@mdtree/core"; import type {NotesGraph, OrganiseHome} from "@mdtree/core";`) to:

```typescript
import {Location, PullDeletion, PageNode, SectionWrite, upsertOrganiseSections} from "@mdtree/core";
import type {NotesGraph, OrganiseHome} from "@mdtree/core";
```

(`SectionWrite` and `upsertOrganiseSections` are added; everything else is unchanged.)

- [ ] **Step 2: Type-check**

Run: `node_modules/.bin/tsc -noEmit -skipLibCheck`
Expected: No errors in `src/obsidian-utils.ts`. Errors remain in `src/view/pull-children/*` and `src/main.ts` (not yet updated) — expected at this point.

- [ ] **Step 3: Run the full test suite**

Run: `bun test`
Expected: Same pass count as before this task (no test file references `applyPullPlan`/`applyOrganisePlan` directly), plus the one pre-existing unrelated failure (`crew-package-integration.test.ts`).

- [ ] **Step 4: Commit**

```bash
git add src/obsidian-utils.ts
git commit -m "feat(pull): applyOrganisePlan writes marker sections and runs deletions"
```

---

### Task 7: Move and rewrite `PullTreeView.tsx` into `src/view/organise-notes/`

**Files:**
- Create: `src/view/organise-notes/PullTreeView.tsx`
- Delete: `src/view/pull-children/PullTreeView.tsx` (folded into this task; the directory is fully removed once Task 8 also moves `PullPreviewModal.tsx`)

No dedicated test — this file has never had one (it's a thin React/Obsidian view, same as every other view component in this codebase); verified via `tsc` and the manual smoke-test checklist in Task 11.

- [ ] **Step 1: Create the new file**

Create `src/view/organise-notes/PullTreeView.tsx`:

```typescript
import React, { useEffect, useMemo, useRef, useState } from "react";
import { App, Component, MarkdownRenderer, Notice } from "obsidian";
import {
    NotesGraph,
    PullNode,
    formatOccurrenceDate,
    planOrganiseWrites,
    planDeletions,
    reverseMarkdownParsing,
    type OrganiseHome,
} from "@mdtree/core";
import { applyOrganisePlan, highlightLine, resolveHome } from "../../obsidian-utils";

function collectDescendantKeys(node: PullNode, out: Set<string>): void {
    for (const child of node.children) {
        out.add(child.key);
        collectDescendantKeys(child, out);
    }
}

function describeNode(node: PullNode): string {
    const date = formatOccurrenceDate(node.node);
    return reverseMarkdownParsing(node.node) + (date ? ` ${date}` : "");
}

type SubtreeState = "all" | "none" | "partial";

function subtreeState(node: PullNode, checked: Set<string>): SubtreeState {
    let anyChecked = checked.has(node.key);
    let anyUnchecked = !checked.has(node.key);
    for (const child of node.children) {
        const state = subtreeState(child, checked);
        if (state !== "none") anyChecked = true;
        if (state !== "all") anyUnchecked = true;
    }
    if (anyChecked && !anyUnchecked) return "all";
    if (!anyChecked) return "none";
    return "partial";
}

type HomeLookup = (pageKey: string) => OrganiseHome;

type Props = {
    app: App;
    graph: NotesGraph;
    root: PullNode;
    notePath: string;
    onApplied: (touchedPaths: string[]) => void;
};

export function PullTreeView({ app, graph, root, notePath, onApplied }: Props) {
    const [checked, setChecked] = useState<Set<string>>(() => {
        const all = new Set<string>();
        collectDescendantKeys(root, all);
        return all;
    });

    const homeOf: HomeLookup = useMemo(() => {
        const cache = new Map<string, OrganiseHome>();
        return (pageKey: string) => {
            if (!cache.has(pageKey)) cache.set(pageKey, resolveHome(app, graph, pageKey, notePath));
            return cache.get(pageKey)!;
        };
    }, [app, graph, notePath]);

    function toggle(node: PullNode, value: boolean): void {
        setChecked(prev => {
            const next = new Set(prev);
            const subtree = new Set<string>([node.key]);
            collectDescendantKeys(node, subtree);
            for (const key of subtree) {
                if (value) next.add(key);
                else next.delete(key);
            }
            return next;
        });
    }

    function resetSelection(): void {
        const all = new Set<string>();
        collectDescendantKeys(root, all);
        setChecked(all);
    }

    async function onConfirm(): Promise<void> {
        const isChecked = (key: string) => checked.has(key);
        const writes = planOrganiseWrites(root, { path: notePath, exists: true }, isChecked, homeOf);
        const deletions = planDeletions(graph, root, isChecked);

        if (writes.length === 0) {
            new Notice("Nothing selected to organise");
            return;
        }

        await applyOrganisePlan(app, writes, deletions);
        const lineCount = writes.reduce((n, w) => n + w.children.length + w.mentions.length, 0);
        const homeCount = writes.length;
        new Notice(
            `Organised ${lineCount} line${lineCount === 1 ? "" : "s"} into ${homeCount} note${homeCount === 1 ? "" : "s"}, ` +
            `removed ${deletions.length} source line${deletions.length === 1 ? "" : "s"}`
        );
        onApplied(writes.map(w => w.home.path));
    }

    return (
        <div className="tw-reset flex flex-col gap-3 p-2 max-h-[70vh] overflow-auto">
            <div className="text-sm text-obs-base-60">
                Select what to organise. Each topic&apos;s own detail lines are filed into that topic&apos;s own note.
            </div>
            <div className="flex flex-col gap-0.5">
                {root.children.length === 0 && (
                    <div className="text-sm text-obs-base-60 italic">Nothing to organise - this node has no children.</div>
                )}
                {root.children.map(child => (
                    <PullRow key={child.key} app={app} node={child} depth={0} checked={checked} onToggle={toggle} homeOf={homeOf} />
                ))}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-obs-border">
                <button className="tw-reset" onClick={resetSelection}>Reset</button>
                <button className="tw-reset font-semibold" onClick={onConfirm}>Organise selected</button>
            </div>
        </div>
    );
}

function MarkdownLine({ app, text, sourcePath }: { app: App; text: string; sourcePath: string }) {
    const ref = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const component = new Component();
        component.load();
        el.empty();
        MarkdownRenderer.render(app, text, el, sourcePath, component).catch(() => { /* best-effort render */ });
        return () => component.unload();
    }, [app, text, sourcePath]);

    return <span ref={ref} className="inline" />;
}

function PullRow({ app, node, depth, checked, onToggle, homeOf }: {
    app: App;
    node: PullNode;
    depth: number;
    checked: Set<string>;
    onToggle: (node: PullNode, value: boolean) => void;
    homeOf: HomeLookup;
}) {
    const ref = useRef<HTMLInputElement>(null);
    const isChecked = checked.has(node.key);
    const state = subtreeState(node, checked);
    const home = node.node.nodeType === "page" ? homeOf(node.key) : null;

    useEffect(() => {
        if (ref.current) ref.current.indeterminate = state === "partial";
    }, [state]);

    return (
        <div>
            <label className="flex items-center gap-2 py-0.5" style={{ paddingLeft: depth * 20 }}>
                <input
                    ref={ref}
                    type="checkbox"
                    checked={isChecked}
                    onChange={e => onToggle(node, e.target.checked)}
                />
                <MarkdownLine app={app} text={describeNode(node)} sourcePath={node.node.location.path} />
                <button
                    type="button"
                    className="tw-reset text-xs text-obs-base-40 underline"
                    onClick={() => highlightLine(app, node.node.location)}
                >
                    reveal source
                </button>
                {home && (
                    <span className="text-xs text-obs-accent italic">
                        → {home.exists ? "" : "(new) "}{home.path}
                    </span>
                )}
            </label>
            {node.children.map(child => (
                <PullRow key={child.key} app={app} node={child} depth={depth + 1} checked={checked} onToggle={onToggle} homeOf={homeOf} />
            ))}
        </div>
    );
}
```

- [ ] **Step 2: Delete the old file**

```bash
rm /Users/costache/dev/src/costache/obsidian-tree-search/src/view/pull-children/PullTreeView.tsx
```

- [ ] **Step 3: Type-check**

Run: `node_modules/.bin/tsc -noEmit -skipLibCheck`
Expected: Errors only in `src/view/pull-children/PullPreviewModal.tsx` (still imports the now-deleted sibling file) and `src/main.ts` — resolved in Task 8/9.

- [ ] **Step 4: Commit**

```bash
git add src/view/organise-notes/PullTreeView.tsx
git rm src/view/pull-children/PullTreeView.tsx
git commit -m "feat(pull): render organise preview rows as real markdown with home/reveal affordances"
```

---

### Task 8: Replace `PullPreviewModal` with the `OrganiseView` pane

**Files:**
- Create: `src/view/organise-notes/OrganiseView.tsx`
- Delete: `src/view/pull-children/PullPreviewModal.tsx` and the (now-empty) `src/view/pull-children/` directory

- [ ] **Step 1: Create the new file**

Create `src/view/organise-notes/OrganiseView.tsx`:

```typescript
import { App, ItemView, Notice, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import React from "react";
import { buildPullTree } from "@mdtree/core";
import { PullTreeView } from "./PullTreeView";
import { GlobalAtoms, GlobalStore } from "../react-context/global";

export const ORGANISE_VIEW = "organise-notes";

const MAX_DEPTH = 5;

export type OrganiseViewState = { rootKey: string; notePath: string };

function isOrganiseViewState(state: unknown): state is OrganiseViewState {
    return !!state && typeof state === "object"
        && typeof (state as OrganiseViewState).rootKey === "string"
        && typeof (state as OrganiseViewState).notePath === "string";
}

/**
 * Persistent pane for "Pull and organise notes", replacing the old
 * transient preview modal. A single instance is reused across invocations
 * (see `openOrganiseView` in main.ts) and retargeted via `setState` rather
 * than re-instantiated - Obsidian calls `setState` on the existing view
 * when `WorkspaceLeaf.setViewState` targets a leaf that already hosts this
 * view type. The pane does not follow the active file; it stays pinned to
 * whichever note it was last targeted at until retargeted again.
 */
export class OrganiseView extends ItemView {
    root: Root | null = null;
    private viewState: OrganiseViewState | null = null;

    constructor(leaf: WorkspaceLeaf, private store: GlobalStore, private refreshFile: (path: string) => Promise<void>) {
        super(leaf);
    }

    getViewType(): string {
        return ORGANISE_VIEW;
    }

    getDisplayText(): string {
        return this.viewState ? `Organise: ${this.viewState.rootKey}` : "Pull and organise notes";
    }

    getIcon(): string {
        return "list-tree";
    }

    getState(): Record<string, unknown> {
        return this.viewState ?? {};
    }

    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        if (isOrganiseViewState(state)) {
            this.viewState = state;
            this.render();
        }
        await super.setState(state, result);
    }

    async onOpen(): Promise<void> {
        this.render();
    }

    async onClose(): Promise<void> {
        this.root?.unmount();
        this.root = null;
    }

    private render(): void {
        if (!this.viewState) return;
        const { rootKey, notePath } = this.viewState;
        const graph = this.store.get(GlobalAtoms.graphAtom);
        const app = this.store.get(GlobalAtoms.appAtom) as App;

        const pullTree = buildPullTree(graph, rootKey, MAX_DEPTH);
        if (!pullTree) {
            new Notice(`Tree Search: "${rootKey}" was not found in the index`);
            return;
        }

        this.root?.unmount();
        this.root = createRoot(this.contentEl);
        this.root.render(
            <PullTreeView
                app={app}
                graph={graph}
                root={pullTree}
                notePath={notePath}
                onApplied={paths => this.handleApplied(paths)}
            />
        );
    }

    private async handleApplied(touchedPaths: string[]): Promise<void> {
        for (const path of touchedPaths) {
            await this.refreshFile(path);
        }
        this.render();
    }
}
```

- [ ] **Step 2: Delete the old modal and directory**

```bash
rm /Users/costache/dev/src/costache/obsidian-tree-search/src/view/pull-children/PullPreviewModal.tsx
rmdir /Users/costache/dev/src/costache/obsidian-tree-search/src/view/pull-children
```

- [ ] **Step 3: Type-check**

Run: `node_modules/.bin/tsc -noEmit -skipLibCheck`
Expected: Errors only in `src/main.ts` (still imports `PullPreviewModal` and doesn't register `ORGANISE_VIEW` yet) — resolved in Task 9.

- [ ] **Step 4: Commit**

```bash
git add src/view/organise-notes/OrganiseView.tsx
git rm src/view/pull-children/PullPreviewModal.tsx
git commit -m "feat(pull): replace the pull preview modal with a persistent organise pane"
```

---

### Task 9: Wire `OrganiseView` into `src/main.ts`, rename the command

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Update imports**

Replace:

```typescript
import {PullPreviewModal} from "./view/pull-children/PullPreviewModal";
```

with:

```typescript
import {ORGANISE_VIEW, OrganiseView, type OrganiseViewState} from "./view/organise-notes/OrganiseView";
```

- [ ] **Step 2: Register the view and add the `openOrganiseView` helper**

In `onload()`, immediately after the existing `this.registerView(FILE_CONTEXT, ...)` block, add:

```typescript
        this.registerView(
            ORGANISE_VIEW,
            (leaf) => new OrganiseView(leaf, this.globalStore, async (path) => {
                const file = this.app.vault.getFileByPath(path);
                if (file) await this.index.refreshPage(file);
            })
        );
```

Add a new method on `TreeSearchPlugin`, right after `activateView`:

```typescript
    async openOrganiseView(rootKey: string, notePath: string): Promise<void> {
        const { workspace } = this.app;
        const state: OrganiseViewState = { rootKey, notePath };

        const leaves = workspace.getLeavesOfType(ORGANISE_VIEW);
        const leaf = leaves.length > 0 ? leaves[0] : workspace.getRightLeaf(false);
        if (!leaf) return;

        await leaf.setViewState({ type: ORGANISE_VIEW, active: true, state });
        workspace.revealLeaf(leaf);
    }
```

- [ ] **Step 3: Fix the now-stale doc comment on `extractLinkKeyFromLine`**

Near the top of the file, replace:

```typescript
// Extracts the graph key ([[page]] or page#header) for the first wikilink on
// `line`, so "Pull into this note" can resolve a root node from wherever the
// cursor happens to sit.
function extractLinkKeyFromLine(line: string): string | null {
```

with:

```typescript
// Extracts the graph key ([[page]] or page#header) for the first wikilink on
// `line`, so "Pull and organise notes" can resolve a root node from
// wherever the cursor happens to sit.
function extractLinkKeyFromLine(line: string): string | null {
```

- [ ] **Step 4: Rename and rewire the command**

Replace the `pull-children` command block:

```typescript
        this.addCommand({
            id: 'pull-children',
            name: 'Pull into this note',
            editorCallback: async (editor) => {
                const activeFile = this.app.workspace.getActiveFile()

                if (!activeFile) {
                    new Notice("Open a note before pulling children into it")
                    return
                }

                // A wikilink under the cursor takes precedence (lets you pull a
                // different page's children into the current note); otherwise
                // fall back to the active note's own key, so running the command
                // anywhere in Parent.md pulls [[parent]]'s children into itself.
                const rootKey = extractLinkKeyFromLine(editor.getLine(editor.getCursor().line))
                    ?? `[[${activeFile.basename.toLowerCase()}]]`

                // Reindex the destination note before building the preview, so a
                // pull run shortly after a previous one (e.g. from a different
                // parent) sees the lines that pull just wrote. Without this, the
                // background debounced reindex may not have caught up yet, so
                // findExistingOccurrence misses the merge target and re-inserts
                // (and re-dates) content that's already there.
                await this.index.refreshPage(activeFile)

                new PullPreviewModal(this.app, this.globalStore.get(GlobalAtoms.graphAtom), rootKey, activeFile.path).open()
            }
        });
```

with:

```typescript
        this.addCommand({
            id: 'organise-notes',
            name: 'Pull and organise notes',
            editorCallback: async (editor) => {
                const activeFile = this.app.workspace.getActiveFile()

                if (!activeFile) {
                    new Notice("Open a note before organising it")
                    return
                }

                // A wikilink under the cursor takes precedence (lets you organise
                // a different page's children into the current note); otherwise
                // fall back to the active note's own key, so running the command
                // anywhere in Parent.md organises [[parent]]'s children.
                const rootKey = extractLinkKeyFromLine(editor.getLine(editor.getCursor().line))
                    ?? `[[${activeFile.basename.toLowerCase()}]]`

                // Reindex the organising note before building the preview, so a
                // run shortly after a previous one (e.g. from a different root)
                // sees the sections that run just wrote - otherwise resolveHome
                // and the preview's tree can miss content that's already there.
                await this.index.refreshPage(activeFile)

                await this.openOrganiseView(rootKey, activeFile.path)
            }
        });
```

- [ ] **Step 5: Rewire the URI protocol handler branch**

Replace:

```typescript
            } else if (uri.raycastaction === "pullChildren") {
                const destinationFile = this.app.workspace.getActiveFile()
                if (!destinationFile) {
                    new Notice("Open a note before pulling children into it")
                } else {
                    await this.index.refreshPage(destinationFile)
                    new PullPreviewModal(this.app, this.globalStore.get(GlobalAtoms.graphAtom), uri.filepath, destinationFile.path).open()
                }
            } else {
```

with:

```typescript
            } else if (uri.raycastaction === "pullChildren") {
                const destinationFile = this.app.workspace.getActiveFile()
                if (!destinationFile) {
                    new Notice("Open a note before organising it")
                } else {
                    await this.index.refreshPage(destinationFile)
                    await this.openOrganiseView(uri.filepath, destinationFile.path)
                }
            } else {
```

(The `raycastaction=pullChildren` wire value is unchanged — it's an internal URI parameter, not user-facing, and the Raycast-side extension that sends it doesn't need to change.)

- [ ] **Step 6: Type-check and run the full test suite**

Run: `node_modules/.bin/tsc -noEmit -skipLibCheck`
Expected: No errors.

Run: `bun test`
Expected: Same pass count as the end of Task 6, plus the one pre-existing unrelated failure (`crew-package-integration.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat(pull): register the organise pane, rename the command to Pull and organise notes"
```

---

### Task 10: Rename the result-action-list entry in `src/view/node-actions.ts`

**Files:**
- Modify: `src/view/node-actions.ts`

- [ ] **Step 1: Update the title**

Replace:

```typescript
    const pullChildrenAction: RaycastAction[] = (isFile && result.node.nodeType === "page") ? [{
        type: "browse",
        url: pullChildrenUrl(result.node.page, vault),
        title: `Pull children into this note`,
        icon: Icons.pencil,
        shortcut: { modifiers: ["ctrl"], key: "p" }
    }] : []
```

with:

```typescript
    const pullChildrenAction: RaycastAction[] = (isFile && result.node.nodeType === "page") ? [{
        type: "browse",
        url: pullChildrenUrl(result.node.page, vault),
        title: `Pull and organise notes`,
        icon: Icons.pencil,
        shortcut: { modifiers: ["ctrl"], key: "p" }
    }] : []
```

(`pullChildrenUrl` and the `raycastaction=pullChildren` value it builds are unchanged — same reasoning as Task 9's URI handler: internal wire format, not user-facing.)

- [ ] **Step 2: Run the view test suite**

Run: `bun test src/view/__tests__/node-actions.test.ts`
Expected: PASS — no existing test asserts on this title string (confirm by checking the test output has the same pass count as before this change).

- [ ] **Step 3: Commit**

```bash
git add src/view/node-actions.ts
git commit -m "feat(pull): rename the action-list entry to Pull and organise notes"
```

---

### Task 11: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full type-check**

Run: `node_modules/.bin/tsc -noEmit -skipLibCheck`
Expected: No errors.

- [ ] **Step 2: Full automated test suite**

Run: `bun test`
Expected: All tests pass except the one pre-existing, unrelated failure in `packages/cli/src/__tests__/crew-package-integration.test.ts` (fails in this environment regardless of this feature; do not attempt to fix it as part of this plan).

- [ ] **Step 3: Manual smoke test in a real vault**

This plan changes file-writing behavior and adds a new pane, neither of which the automated suite exercises end-to-end (no Obsidian runtime in `bun test`). Load the plugin in a real (or scratch) vault and walk through:

1. Build the plugin: `npm run build` (or `node esbuild.config.mjs` for a dev build), then reload the plugin in Obsidian (or restart Obsidian with the dev build symlinked into the vault's `.obsidian/plugins/` folder, per this repo's existing dev workflow).
2. Create three notes: `Parent.md` with body `- [[Child]]`; a daily note `Daily.md` with body `- [[Child]] bought milk` and `- [[Child]] http://example.com`; leave `Child.md` **not** created.
3. Open `Parent.md`, put the cursor anywhere in it (not necessarily on the `[[Child]]` line), run the command palette → "Pull and organise notes".
4. Confirm: a pane opens in the right sidebar (not a modal — you can still click elsewhere in the vault while it's open). It shows `[[Child]]` as a checkbox row, rendered as a real clickable link (not raw `[[Child]]` text), with a "(new) Child.md" home annotation, and its two mention children (bought milk / http://example.com) nested under it, also rendered as real markdown/links, each with a "reveal source" button.
5. Click "reveal source" on one of the mention rows — confirm it opens `Daily.md` and highlights that exact line.
6. Leave everything checked, click "Organise selected". Confirm: a new `Child.md` is created (same folder as `Parent.md`) containing an `<!-- organise:children -->`/`<!-- organise:mentions -->` block with both mention lines and their dates; `Parent.md` gets an `<!-- organise:children -->` block containing `- [[Child]]` and an empty `<!-- organise:mentions -->` block; both now-fully-consumed lines are deleted from `Daily.md`; the pane stays open and its tree refreshes in place (doesn't close).
7. Run the command again from `Parent.md` (cursor anywhere). Confirm no duplicate `[[Child]]` line appears in `Parent.md`'s children section and no duplicate mention lines appear in `Child.md`'s mentions section.
8. From the tree-search result action list (open the search pane, find a page-type result, open its action list), confirm the entry now reads "Pull and organise notes" and triggers the same pane.

Record the outcome of this manual pass in the PR/commit description when this plan is executed — it is not automatable in this repo's current test setup, so it's the actual verification of record for Tasks 6-10.

---

### Task 12: Supersede the in-flight `pull-children-into-note` openspec change

**Files:**
- Modify: `openspec/changes/pull-children-into-note/proposal.md` (or wherever this repo's openspec convention records supersession — check `openspec/` for an existing "superseded" or "archived" convention first via `ls openspec/changes/` and any archive folder before assuming the shape below)

- [ ] **Step 1: Check the repo's openspec archival convention**

Run: `ls /Users/costache/dev/src/costache/obsidian-tree-search/openspec/changes/` and, if present, `ls /Users/costache/dev/src/costache/obsidian-tree-search/openspec/changes/archive/` (or similar) to see how a prior completed/superseded change was recorded. Follow that exact convention rather than inventing a new one.

- [ ] **Step 2: Record the supersession**

Add a short note at the top of `openspec/changes/pull-children-into-note/proposal.md` (above the existing `## Why` section):

```markdown
> **Superseded** by "Pull and organise notes" (`docs/superpowers/specs/2026-08-27-pull-and-organise-notes-design.md`), implemented 2026-08-27. That change reverses this proposal's "single-destination, cursor-anchored" targeting in favor of per-topic home routing. Kept here for history; do not implement this proposal as originally written.
```

If the repo's convention (checked in Step 1) uses a dedicated archive mechanism (e.g. a CLI command or a move to an `archive/` folder) instead of an inline note, use that mechanism instead and skip this inline edit.

- [ ] **Step 3: Commit**

```bash
git add openspec/changes/pull-children-into-note/
git commit -m "docs: mark pull-children-into-note openspec change as superseded"
```

---

## Self-review notes

- **Spec coverage:** every numbered section of the design doc maps to at least one task (see the coverage table above); the two stated Non-Goals (configurable auto-create folder, reconciling hand-edits inside managed sections) are correctly *not* implemented anywhere in this plan.
- **Type consistency check:** `OrganiseHome { path, exists }` and `SectionWrite { home, children, mentions }` (Task 1) are the exact shapes imported and consumed in Task 5 (`resolveHome` returns `OrganiseHome`), Task 6 (`applyOrganisePlan(app, writes: SectionWrite[], deletions)`), and Task 7 (`PullTreeView`'s `homeOf: HomeLookup` returns `OrganiseHome`, `planOrganiseWrites(root, {path, exists: true}, isChecked, homeOf)`) — no renamed fields between tasks.
- **No placeholders:** every step above contains complete, runnable code — no "add error handling" or "similar to Task N" shortcuts.
