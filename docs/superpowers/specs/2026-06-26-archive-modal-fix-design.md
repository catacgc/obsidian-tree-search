# Archive Action: Keep Modal Open, Fix Result Reactivity

**Date:** 2026-06-26
**Status:** Approved

## Background

The archive action in the Obsidian search modal has two bugs:

1. **Modal closes on archive.** `executeActionAtom` in `actions.tsx` unconditionally calls `set(closeModalAtom)` after every action. Archive is a `browse` action, so the modal closes immediately even though the user should stay in the search view.

2. **Search results don't update after archive.** `refreshPage` in `IndexedTree` mutates `this.graph` in-place via `reindexFileInGraph`, then calls `setState(this.graph)` — the same object reference. Jotai uses `Object.is` to detect atom changes: `Object.is(this.graph, this.graph)` is always `true`, so `graphAtom` subscribers don't re-run. `graphVersionAtom` is incremented (a new number), but `SearchModalMolecule`'s `searchResultsComputeAtom` subscribes only to `graphAtom`, not `graphVersionAtom`. The sidebar `SearchPage` works correctly because it subscribes to `graphVersionAtom` via `useEffect`.

A third issue is included in scope: `SearchPage.tsx` still references `GlobalAtoms.parserTypeAtom` (removed during the WASM cleanup), causing a TypeScript error.

## Files Changed

- Modify: `src/view/node-actions.ts`
- Modify: `src/view/react-context/actions.tsx`
- Modify: `src/view/react-context/state.tsx`
- Modify: `src/view/SearchPage.tsx`

## Fix 1 — Modal Stays Open (`node-actions.ts` + `actions.tsx`)

### `node-actions.ts`

Add two optional fields to `Browse`:

```typescript
export interface Browse extends BaseAction {
    type: "browse"
    url: string
    keepOpen?: boolean   // when true: don't close modal after execution
    location?: Location  // provided when keepOpen is true; avoids re-parsing the URL
}
```

Archive and unarchive actions set both fields:

```typescript
isArchived(result.node) ? {
    type: "browse",
    url: unarchiveUrl(result.node.location, vault),
    title: "Unarchive",
    icon: Icons.bookmark,
    keepOpen: true,
    location: result.node.location,
} : {
    type: "browse",
    url: archiveUrl(result.node.location, vault),
    title: "Archive",
    icon: Icons.bookmark,
    keepOpen: true,
    location: result.node.location,
}
```

The `url` field is kept intact so the Raycast path continues working unchanged (Raycast ignores `keepOpen` and `location`).

### `actions.tsx`

`executeActionAtom` gains a fast-path for `keepOpen` actions. It calls `archiveLine`/`unarchiveLine` directly from `obsidian-utils` (using `app` from `appAtom`), and returns without calling `closeModalAtom`:

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

Required import added to `actions.tsx`:
```typescript
import { archiveLine, unarchiveLine } from "../../obsidian-utils"
```

## Fix 2 — Results Update After Archive (`state.tsx`)

One line added to `SearchModalMolecule`'s `searchResultsComputeAtom`. Reading `graphVersionAtom` subscribes the effect to version increments, ensuring it re-runs after `refreshPage` calls even though `graphAtom` holds the same object reference:

```typescript
const searchResultsComputeAtom = withAtomEffect(searchResultsAtom, (get, set) => {
    get(GlobalAtoms.graphVersionAtom)  // re-run on mutable graph updates from refreshPage
    const searchQuery = get(searchMol.actualQueryAtom)
    const graph = get(GlobalAtoms.graphAtom)
    const separator = get(separatorAtom)
    // ... rest unchanged
})
```

The index refresh chain is unchanged: `archiveLine` calls `app.vault.modify` → Obsidian fires the `modify` vault event → `main.ts`'s debounced handler calls `index.refreshPage(file)` → `setState` increments `graphVersionAtom` → `searchResultsComputeAtom` re-runs → `partitionArchived` filters the now-archived item → results update in-place with the modal still open.

## Fix 3 — Stale `parserTypeAtom` Reference (`SearchPage.tsx`)

Remove the two lines referencing the deleted atom:

```typescript
// Remove:
const parserType = useAtomValue(GlobalAtoms.parserTypeAtom)

// Remove from JSX:
<span className="text-[10px] text-obs-base-40">parser: {parserType} • {graphOrder} nodes</span>
// Replace with (already done in the modal path; apply same change here):
<span className="text-[10px] text-obs-base-40">{graphOrder} nodes</span>
```

## What Does Not Change

- `obsidian-utils.ts` (`archiveLine`, `unarchiveLine`) — unchanged
- `main.ts` URI protocol handler — unchanged (Raycast still works via URL)
- `IndexedTree` — unchanged (`refreshPage` mutation pattern stays; the fix is in the subscriber)
- `packages/core/` — unchanged
- Raycast action format — unchanged (`keepOpen` and `location` are ignored by Raycast)
