# Archive Modal Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs in the Obsidian search modal archive action: (1) modal closes when it should stay open, (2) search results don't update after archiving. Also remove stale parserTypeAtom reference.

**Architecture:** Three independent fixes in the React view layer. Task 1 adds keepOpen flag to Browse action type and sets it on archive/unarchive. Task 2 adds fast-path in executeActionAtom to handle keepOpen actions without closing modal. Task 3 subscribes searchResultsComputeAtom to graphVersionAtom. Task 4 removes stale TypeScript reference.

**Tech Stack:** TypeScript, React, Jotai atoms, Obsidian API

---

## File Structure

**Modified files (4 total):**
- `src/view/node-actions.ts` — action type definitions and action builders
- `src/view/react-context/actions.tsx` — action execution atom (modal lifecycle)
- `src/view/react-context/state.tsx` — search result atoms (reactive subscriptions)
- `src/view/SearchPage.tsx` — sidebar search page (stale atom reference)

All changes are in the view layer. No changes to core, CLI, or indexing logic.

---

### Task 1: Add keepOpen + location to Browse action type

**Files:**
- Modify: `src/view/node-actions.ts`

- [ ] **Step 1: Add keepOpen and location to Browse interface**

Read the current `Browse` interface definition (around line 33). Update it to:

```typescript
export interface Browse extends BaseAction {
    type: "browse"
    url: string
    keepOpen?: boolean
    location?: Location
}
```

**Why:** `keepOpen` signals the action executor to skip closing the modal. `location` provides the already-parsed location so we don't re-parse from URL.

- [ ] **Step 2: Update archive action to set keepOpen and location**

Find the `archiveAction` constant inside `getDefaultActions` (around line 128). The ternary currently returns:

```typescript
const archiveAction: RaycastAction[] = isText ? [
    isArchived(result.node) ? {
        type: "browse",
        url: unarchiveUrl(result.node.location, vault),
        title: `Unarchive`,
        icon: Icons.bookmark
    } : {
        type: "browse",
        url: archiveUrl(result.node.location, vault),
        title: `Archive`,
        icon: Icons.bookmark
    }
] : []
```

Change it to:

```typescript
const archiveAction: RaycastAction[] = isText ? [
    isArchived(result.node) ? {
        type: "browse",
        url: unarchiveUrl(result.node.location, vault),
        title: `Unarchive`,
        icon: Icons.bookmark,
        keepOpen: true,
        location: result.node.location
    } : {
        type: "browse",
        url: archiveUrl(result.node.location, vault),
        title: `Archive`,
        icon: Icons.bookmark,
        keepOpen: true,
        location: result.node.location
    }
] : []
```

**Why:** Setting `keepOpen: true` and providing `location` enables the fast-path in Task 2. The `url` field stays intact for Raycast compatibility (Raycast ignores the extra fields).

- [ ] **Step 3: Verify TypeScript compiles**

Run:
```bash
npm run build
```

Expected: No TypeScript errors. The new optional fields should not break existing code.

- [ ] **Step 4: Commit**

```bash
git add src/view/node-actions.ts
git commit -m "feat: add keepOpen and location fields to Browse action type"
```

---

### Task 2: Add fast-path for keepOpen actions in executeActionAtom

**Files:**
- Modify: `src/view/react-context/actions.tsx`

- [ ] **Step 1: Add import for archiveLine and unarchiveLine**

At the top of the file (after the existing imports around lines 1-8), add:

```typescript
import { archiveLine, unarchiveLine } from "../../obsidian-utils"
```

**Why:** We need these functions to directly execute archive operations without the `window.open` roundabout.

- [ ] **Step 2: Update executeActionAtom to handle keepOpen**

Find the `executeActionAtom` definition (around line 85). It currently looks like:

```typescript
const executeActionAtom = atom(null, async (get, set, action: RaycastAction) => {
    await executeAction(action)
    set(closeModalAtom)
})
```

Replace it with:

```typescript
const executeActionAtom = atom(null, async (get, set, action: RaycastAction) => {
    if (action.type === "browse" && action.keepOpen && action.location) {
        const app = get(appAtom)
        if (action.url.includes("raycastaction=archive")) {
            await archiveLine(app, action.location)
        } else {
            await unarchiveLine(app, action.location)
        }
        return  // modal stays open
    }
    await executeAction(action)
    set(closeModalAtom)
})
```

**Why:** When `keepOpen` is set, we call `archiveLine`/`unarchiveLine` directly and return early without calling `closeModalAtom`. Normal actions still go through `executeAction` and close the modal.

**How it works:** The URL check distinguishes archive from unarchive (both have `keepOpen: true`). `archiveLine` modifies the file → triggers `modify` vault event → `main.ts` calls `index.refreshPage` → `graphVersionAtom` increments → search results update (Task 3 makes them react to `graphVersionAtom`).

- [ ] **Step 3: Verify TypeScript compiles**

Run:
```bash
npm run build
```

Expected: No errors. `action.location` is typed as `Location | undefined` from the interface update in Task 1, so the type guard `action.location` is safe.

- [ ] **Step 4: Commit**

```bash
git add src/view/react-context/actions.tsx
git commit -m "feat: add keepOpen fast-path in executeActionAtom for archive actions"
```

---

### Task 3: Subscribe searchResultsComputeAtom to graphVersionAtom

**Files:**
- Modify: `src/view/react-context/state.tsx`

- [ ] **Step 1: Add graphVersionAtom subscription to searchResultsComputeAtom**

Find the `searchResultsComputeAtom` definition inside `SearchModalMolecule` (around line 130). It currently looks like:

```typescript
const searchResultsComputeAtom = withAtomEffect(searchResultsAtom, (get, set) => {
    const searchQuery = get(searchMol.actualQueryAtom)
    const isQuickLink = scp.isQuickLink
    const graph = get(GlobalAtoms.graphAtom)
    const separator = get(separatorAtom)
    
    const search = (isQuickLink && searchQuery.length > 0) ? `${searchQuery} . :page | :header` : searchQuery
    
    const searchResults = searchIndex(graph, search, separator)
    const { visible, archivedCount } = partitionArchived(searchResults)
    set(searchMol.updateSearchResultsAtom, visible, archivedCount)
})
```

Add one line at the start of the effect body:

```typescript
const searchResultsComputeAtom = withAtomEffect(searchResultsAtom, (get, set) => {
    get(GlobalAtoms.graphVersionAtom)  // re-run on mutable graph updates from refreshPage
    const searchQuery = get(searchMol.actualQueryAtom)
    const isQuickLink = scp.isQuickLink
    const graph = get(GlobalAtoms.graphAtom)
    const separator = get(separatorAtom)
    
    const search = (isQuickLink && searchQuery.length > 0) ? `${searchQuery} . :page | :header` : searchQuery
    
    const searchResults = searchIndex(graph, search, separator)
    const { visible, archivedCount } = partitionArchived(searchResults)
    set(searchMol.updateSearchResultsAtom, visible, archivedCount)
})
```

**Why:** `refreshPage` mutates `this.graph` in-place, then calls `setState(this.graph)` — same object reference, so `graphAtom` subscribers don't re-run (`Object.is(this.graph, this.graph)` is always `true`). But `graphVersionAtom` is incremented (a new number each time). By reading `graphVersionAtom`, we subscribe to version changes, so the effect re-runs after `refreshPage` even though `graphAtom` is the same reference.

**How it works:** Archive action → `archiveLine` modifies file → Obsidian `modify` event → `index.refreshPage(file)` → `setState` sets same graph reference but increments `graphVersionAtom` → `searchResultsComputeAtom` re-runs because it now reads `graphVersionAtom` → `searchIndex` and `partitionArchived` run again → archived item is filtered out → results update while modal stays open.

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
npm run build
```

Expected: No errors. `get(GlobalAtoms.graphVersionAtom)` returns a number; we don't use it, but the `get()` call subscribes the effect.

- [ ] **Step 3: Commit**

```bash
git add src/view/react-context/state.tsx
git commit -m "fix: subscribe searchResultsComputeAtom to graphVersionAtom for reactive updates"
```

---

### Task 4: Remove stale parserTypeAtom reference from SearchPage.tsx

**Files:**
- Modify: `src/view/SearchPage.tsx`

- [ ] **Step 1: Remove parserType variable declaration**

Find line 48 in `SearchPage.tsx`:

```typescript
const parserType = useAtomValue(GlobalAtoms.parserTypeAtom)
```

Delete this line entirely.

**Why:** `parserTypeAtom` was removed during the WASM cleanup (Tasks 1–4 from the earlier plan). This reference causes a TypeScript error.

- [ ] **Step 2: Update JSX to remove parserType from status line**

Find line 57 in `SearchPage.tsx`:

```typescript
<span className="text-[10px] text-obs-base-40">parser: {parserType} • {graphOrder} nodes</span>
```

Change it to:

```typescript
<span className="text-[10px] text-obs-base-40">{graphOrder} nodes</span>
```

**Why:** We no longer track parser type (only one parser now — TypeScript). The modal path already uses this simplified format; applying the same change here.

- [ ] **Step 3: Verify TypeScript compiles**

Run:
```bash
npm run build
```

Expected: No errors. The `parserTypeAtom` TypeScript error is gone.

- [ ] **Step 4: Commit**

```bash
git add src/view/SearchPage.tsx
git commit -m "fix: remove stale parserTypeAtom reference from SearchPage"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Fix 1 (modal stays open): Task 1 + Task 2
- ✅ Fix 2 (results update): Task 3
- ✅ Fix 3 (stale atom): Task 4

**Placeholder check:**
- No TBD, TODO, or "similar to Task N" patterns
- All code blocks are complete
- All file paths are exact

**Type consistency:**
- `Browse.keepOpen` and `Browse.location` defined in Task 1, used in Task 2 ✅
- `GlobalAtoms.graphVersionAtom` used in Task 3 (exists in codebase) ✅
- `GlobalAtoms.parserTypeAtom` removed in Task 4 (doesn't exist anymore) ✅

---

## Testing

**Manual test:**
1. Open the search modal (Cmd+Shift+P → "Search")
2. Search for a text node
3. Select it and click "Archive" action
4. **Expected:** Modal stays open, archived item disappears from results
5. Click "Unarchive" on an archived item
6. **Expected:** Modal stays open, item reappears in results

**Regression test:**
- Other actions (Open, Copy, Insert) should still close the modal as before
- Raycast archive action should still work (ignores `keepOpen`/`location` fields)
- Sidebar search view should still work (already subscribed to `graphVersionAtom`)
