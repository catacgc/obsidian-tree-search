# Pull and Organise Notes

**Date:** 2026-08-27
**Status:** Approved

## Background

"Pull children into this note" (`openspec/changes/pull-children-into-note/`, implemented this session) consolidates a topic's graph subtree into whichever note is currently active, at the cursor. Two behavior changes landed earlier this session on top of that baseline:

1. The command now falls back to the active note's own key as the pull root when the cursor isn't on a `[[wikilink]]` line (`src/main.ts`).
2. `buildPullTree` (`packages/core/src/search/pull.ts`) excludes a real page's own headers/body from the traversal (walking through them transparently to still reach nested `[[Page]]` children), so pulling "from Parent" doesn't sweep in Parent's entire own note content.

This spec is the next step: it turns the feature from "consolidate everything into the note you're standing in" into **"organise scattered content into each topic's own note"**, renames it accordingly, gives the preview a proper rendered/clickable UI, and replaces the transient preview modal with a persistent pane. It explicitly reverses a stated non-goal of the original design ("no support for pulling into a note other than the currently active one... out of scope") — that restriction is the thing being removed here.

## Goals / Non-Goals

**Goals:**
- Every topic reached while organising ends up with its own checked children written into *its own* note (real file if one exists, auto-created otherwise), not flattened into the note you started from.
- The note you organise from always shows its direct topic links, in a clean, non-nested list, plus a separate list of text mentions that reference it — both idempotently maintained across repeated runs.
- The preview is a live pane, not a blocking modal: links render as real, clickable Obsidian links so you can navigate to a mention's source before deciding to include it.

**Non-Goals:**
- No support for reconciling manual edits inside a previously-written Children/Mentions section beyond what marker-bounded upsert naturally gives (last-write-wins on the whole section, same idempotency contract as before, just section-scoped now).
- No configurable location for auto-created notes in this iteration — always same-folder-as-the-organising-note (a settings field can follow later if wanted).
- No change to depth limit (5), dedup-by-key, or the own-body exclusion added earlier this session — this spec is additive to that traversal, not a revision of it.

## Files Changed

- Modify: `packages/core/src/search/pull.ts` — replace `PullWrite`/`PullWriteAnchor`/`planPullWrites` with home resolution + section-collection.
- Modify: `packages/core/src/__tests__/pull.test.ts` — retarget existing write/deletion tests at the new planner; add home-resolution and recursion tests.
- Modify: `src/obsidian-utils.ts` — replace `applyPullPlan` with `applyOrganisePlan` (creates files, upserts marker-bounded sections, then applies deletions).
- Rename directory `src/view/pull-children/` → `src/view/organise-notes/`; replace `PullPreviewModal.tsx` with `OrganiseView.tsx` (an `ItemView`); `PullTreeView.tsx` gains markdown rendering.
- Modify: `src/main.ts` — register `ORGANISE_VIEW`, rename command to "Pull and organise notes", update the `pullChildren` URI branch to open the pane instead of a modal.
- Modify: `src/view/node-actions.ts` — rename the action-list entry to "Pull and organise notes" (URL/action plumbing unchanged).

## Decisions

### 1. Home resolution replaces destination-scoped merge detection

Today, `findExistingOccurrence(graph, key, destinationPath)` asks "does `key` already occur in *this one* note" — the note you're pulling into. That collapses to a single-destination model that no longer fits: every topic now gets resolved to its own home, independent of which note you started from.

New helper in `obsidian-utils.ts` (needs `app.vault`, so it can't live in `packages/core`):

```typescript
type OrganiseHome = { path: string; exists: boolean }

function resolveHome(app: App, graph: NotesGraph, pageKey: string, organisingNotePath: string): OrganiseHome {
  const node = graph.getNodeAttributes(pageKey) // page-type, guaranteed by caller
  if (!node.isReference) return { path: node.location.path, exists: true }
  const folder = organisingNotePath.includes("/") ? organisingNotePath.slice(0, organisingNotePath.lastIndexOf("/")) : ""
  const fileName = pageKeyToFileName(pageKey) // strip [[ ]], restore original casing from node.page
  const candidate = folder ? `${folder}/${fileName}.md` : `${fileName}.md`
  return { path: candidate, exists: app.vault.getFileByPath(candidate) != null }
}
```

A topic's home is resolved once per organise run (memoized by key), the first time it's reached with at least one checked child — a topic with no checked children never gets a home computed or a file created for it.

### 2. `planOrganiseWrites` — per-home section collection, not per-node cursor/merge anchors

Replaces `planPullWrites` in `packages/core/src/search/pull.ts`. Signature:

```typescript
type SectionWrite = { home: OrganiseHome; children: PullLine[]; mentions: PullLine[] }

function planOrganiseWrites(
  root: PullNode,
  isChecked: (key: string) => boolean,
  resolveHome: (pageKey: string) => OrganiseHome,
): SectionWrite[]
```

Walk starting at `root` with `root`'s own home as the current anchor (the organising note itself — always exists, never auto-created). For the current anchor's node:
- Every **checked page-type child** gets one bare-link line (`- [[Child]]`, no date, no nested content) appended to the anchor's `children` list, *and* is recursed into using **that child's own home** as the new anchor for its descendants (not the current anchor) — this is the core routing change.
- Every **checked text-type child** gets rendered exactly as today (verbatim line + date via `formatOccurrenceDate`) and appended to the anchor's `mentions` list.
- An anchor with no checked children of either kind contributes no `SectionWrite`.

One `SectionWrite` per distinct home is emitted (a home reached via more than one path in the tree — not expected given upstream dedup, but merge defensively by home path if it happens).

`planDeletions` is unchanged in contract and mostly in implementation: a source line is still deletable once every one of its checked (non-folder) graph children is itself accounted for somewhere in this organise run. It's re-pointed at the new tree walk but doesn't need home-awareness itself — it only cares whether a child was checked, not where it ended up.

### 3. File writing — marker-bounded, idempotent sections (`applyOrganisePlan`)

Two fixed regions, always in this order, always at the top of the note (after frontmatter if present, before the rest of the note, separated by a blank line):

```markdown
<!-- organise:children -->
- [[Child]]
- [[Child2]]
<!-- /organise:children -->

<!-- organise:mentions -->
- [[Parent]] some note about it
- [[Parent]] http://example.com
<!-- /organise:mentions -->

(rest of the note, untouched)
```

`applyOrganisePlan(app, writes, deletions)`:
1. For each `SectionWrite` whose `home.exists` is `false`, `app.vault.create(home.path, "")` first (so later steps can treat every home uniformly as an existing file). Skip if a race means it now exists (re-check via `getFileByPath` immediately before create).
2. For each `SectionWrite`, read the home file, locate each marker pair by exact string match:
   - If both markers exist: replace the region between them with the new rendered line list (empty list ⇒ empty region, markers stay — a topic can lose all its children/mentions across the vault and still keep an empty, ready-to-refill section rather than the markers disappearing and needing re-creation logic).
   - If neither exists: insert both blocks (children first, then a blank line, then mentions) immediately after frontmatter (or at line 0 if none), before whatever else is in the file.
   - Children-list membership is deduped against the existing region's content by exact rendered line before appending (running the command twice with the same checked set never duplicates a link).
3. Apply `deletions` exactly as `applyPullPlan` does today (unchanged logic, same function extracted/reused).

This fully replaces cursor-based insertion — the active editor's cursor position is no longer read anywhere in the organise flow. `insertHere` stays for the unrelated Quick Link feature; it's just not called from this path anymore.

### 4. Rendering — real markdown/wikilinks in the preview

`PullTreeView`'s `describeNode` (plain-text `reverseMarkdownParsing` + date) is replaced by a small `<PullLineMarkdown text={...} sourcePath={...} />` component that renders via Obsidian's `MarkdownRenderer.render(app, text, containerEl, sourcePath, component)` into a ref'd container in a `useEffect` (async — `MarkdownRenderer.render` returns a promise; render into a placeholder, swap on resolve). `sourcePath` is the node's own `location.path`, matching how Obsidian resolves relative/shortest-path wikilinks elsewhere in the vault. Internal links get their default Obsidian click-to-open behavior for free. The existing "already recorded at line N" annotation becomes a clickable span that calls the same reveal/open logic `highlightLine` already provides, jumping straight to that source position.

### 5. Pane — `OrganiseView` replaces `PullPreviewModal`

New `ItemView` (`ORGANISE_VIEW = "organise-notes"`), registered in `main.ts` next to `SEARCH_VIEW`/`FILE_CONTEXT`, opened via a `getLeavesOfType`-reuse helper mirroring `activateView` — **single instance, retargeted** on each invocation (running the command again, from any note, replaces what the existing pane shows rather than opening a second one). Constructed/retargeted with a fixed `(rootKey, notePath, graph)` tuple passed at open/retarget time — **not** subscribed to `activeFileAtom`, per explicit decision: the pane stays pinned to whichever note it was triggered for, even if you navigate elsewhere in the main editor.

`PullTreeView`'s tree/checkbox logic is unchanged in shape; only the anchor concept changes (no more `existingOf`/"already in this note" single-destination lookup — replaced by the home-resolution described above, surfaced in the UI as "will be filed into: <home path>" per top-level topic row, so you can see where the pull is about to land before confirming). "Apply" is a persistent button; after applying, the view calls `refreshPage` on every touched home file (closing the staleness gap the same way this session's earlier fix did for the modal) and rebuilds its own tree from the refreshed graph in place, rather than closing.

### 6. Naming

- Command id `pull-children` is renamed to `organise-notes` (ids aren't user-visible; existing user hotkey bindings to the old id would need to be re-bound, acceptable since this is a behavior change anyway, not a pure rename).
- Command name / action-list label: **"Pull and organise notes"**.

## Risks / Trade-offs

- **[Risk]** Auto-creating a note per first-seen topic could create a lot of small files in a densely-linked vault (every never-before-homed `[[Child]]` mentioned anywhere under the organised root gets a file). → Mitigation: only topics with at least one *checked* child ever get a home computed/created — unchecking a branch in the preview before applying avoids file creation for it, same as it avoids writing it at all.
- **[Risk]** Marker-bounded section upsert assumes the user doesn't hand-edit inside the `<!-- organise:children -->...<!-- /organise:children -->` region and expect those edits preserved across a re-run with a different checked set — a manual addition inside the region survives only if it happens to also appear in the freshly rendered list. → Mitigation: documented as known behavior (same "the tool owns this region" contract as e.g. a linter's autofix block); not solved with per-line diffing in this iteration.
- **[Trade-off]** Dropping cursor-based insertion entirely means the command's behavior is now fully independent of where your cursor is (beyond initial root resolution) — a deliberate simplification per this spec's decisions, but a change from today's mental model ("pull inserts where I'm typing").
- **[Risk]** Resolving a home mid-walk requires a canonical (non-edge-overridden) node lookup, same gotcha this session already hit once in `buildPullTree`'s own-body exclusion (`graph.getNodeAttributes(key)`, not the edge-adjusted copy). → Mitigation: `resolveHome` takes a bare `pageKey` and always calls `graph.getNodeAttributes` itself; it's never handed a `PullNode`'s edge-adjusted `.node`.

## Migration Plan

Additive to the existing feature, but replaces its write path and UI surface entirely:
- `PullWrite`/`PullWriteAnchor`/`planPullWrites`/`applyPullPlan` are removed, not deprecated-in-place (no other caller exists).
- `PullPreviewModal` is deleted; `src/view/pull-children/` is renamed to `src/view/organise-notes/`.
- The in-flight `openspec/changes/pull-children-into-note/` change should be archived/superseded by a new openspec change for this rename + behavior shift once this spec's plan is implemented, since several of its stated requirements (single-destination targeting, cursor-anchored insertion) are explicitly reversed here.
- No stored/persisted data format changes — everything here operates on the graph (already-indexed state) and vault files directly.
