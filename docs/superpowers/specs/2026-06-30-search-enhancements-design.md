# Search Enhancements with Archive Refresh Fix

Date: 2026-06-30

## Overview

This design adds three enhancements to the Obsidian tree search plugin's search functionality:

1. Keyboard shortcuts for search result actions (e.g., Ctrl+E for archive)
2. Exact word matching operator (`:word` or `:w`)
3. Comprehensive search help display in empty search state and via toggle button
4. Fix for archive refresh bug where archived items don't disappear until manual refresh

## Requirements

### Keyboard Shortcuts
- Add sensible default keyboard shortcuts for common actions
- Archive/unarchive: Ctrl+E
- Shortcuts should be documented in the help text
- Modal stays open after archiving (keep current behavior)

### Word Matching Operator
- Add `:word` or `:w` operator that applies whole-word matching to all search terms
- Example: "ibm cost :word" matches "IBM Cost" but not "IBM Costin"
- Case-insensitive matching with word boundaries

### Search Help
- Display comprehensive help when search box is empty (default visible)
- Add "?" toggle button to show/hide help at any time
- Include: operators, shortcuts, and search tips with examples
- Help appears in the results area (middle of modal)

### Archive Refresh Fix
- When archiving/unarchiving items, they should disappear immediately
- No manual refresh required
- Parse cache should persist after archive operations

## Architecture

The design touches four main areas:

### 1. Query Parser Extension
**File:** `packages/core/src/search/query.ts`

Add `:word` as a new query modifier that changes matching behavior for all search terms to use word boundaries.

### 2. Keyboard Action System
**Files:** 
- `src/view/search/KeyComboWrapper.tsx`
- `src/view/react-context/actions.tsx`

Refactor hardcoded keyboard handlers into a data-driven action registry that maps shortcuts to action atoms.

### 3. Search Help Component
**File:** `src/view/search/SearchHelp.tsx` (new)

Create a comprehensive help component that displays operators, shortcuts, and tips. Integrates with SearchBar and SearchViewFlatten for visibility control.

### 4. Archive Refresh Fix
**Files:**
- `src/view/react-context/actions.tsx`
- `src/indexing/indexed-tree.ts`
- `src/view/react-context/global.tsx`
- `src/main.ts`

Trigger `refreshPage` after archive operations and ensure cache persistence.

## Detailed Design

### Query Parser - Word Matching Operator

**Add `:word` to QueryModifier type:**

```typescript
export type QueryModifier =
  | ":task"
  | ":emoji"
  | ":page"
  | ":header"
  | ":folder"
  | ":attachment"
  | ":word"
```

**Update QUERY_MODIFIERS array:**
```typescript
const QUERY_MODIFIERS: QueryModifier[] = [
  ":task",
  ":emoji",
  ":page",
  ":header",
  ":folder",
  ":attachment",
  ":word",
]
```

**Implementation Strategy:**

The `:word` modifier changes the matching behavior for all `contains` expressions in the query. To implement this:

1. Add a helper function `hasWordModifier(expr: QueryExpr): boolean` that recursively checks if a `:word` modifier exists anywhere in the expression tree

2. Add a helper function `matchesWord(searchKey: string, term: string): boolean`:
   ```typescript
   function matchesWord(searchKey: string, term: string): boolean {
     const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
     const regex = new RegExp(`\\b${escaped}\\b`, 'i')
     return regex.test(searchKey)
   }
   ```

3. Modify `matchQuery` to accept an optional `wordMode` parameter that cascades down:
   ```typescript
   export function matchQuery(attrs: ParsedNode, expr: QueryExpr, wordMode = false): boolean {
     // If we encounter :word modifier, set wordMode for child expressions
     if (expr.type === "modifier" && expr.value === ":word") {
       return true // :word itself always matches
     }
     
     // Check if this expression tree contains :word
     const hasWord = hasWordModifier(expr)
     const useWordMode = wordMode || hasWord
     
     switch (expr.type) {
       case "contains":
         if (useWordMode) {
           return matchesWord(attrs.searchKey, expr.value)
         }
         return attrs.searchKey.toLowerCase().includes(expr.value.toLowerCase())
       
       case "and":
         return expr.exprs.every(e => matchQuery(attrs, e, useWordMode))
       
       case "or":
         return expr.exprs.some(e => matchQuery(attrs, e, useWordMode))
       
       // ... other cases
     }
   }
   ```

**Query Examples:**
- `"ibm cost :word"` → `{type: "and", exprs: [{contains: "ibm"}, {contains: "cost"}, {modifier: ":word"}]}`
- Both "ibm" and "cost" must match as whole words
- "IBM Cost Analysis" ✅ matches
- "IBM Costin" ❌ does not match

### Keyboard Action System Refactor

**Current Problem:**
`KeyComboWrapper` has hardcoded if-else chains that are hard to maintain and document.

**Solution:**
Create a data-driven action registry.

**Action Registry Definition:**

```typescript
type KeyboardAction = {
  key: string
  modifiers: string[]  // ["ctrl"], ["shift"], ["ctrl", "alt"], etc.
  atomName: string     // which atom to execute
  description: string  // for help text
}

export const KEYBOARD_ACTIONS: KeyboardAction[] = [
  { key: "enter", modifiers: [], atomName: "handleDefault", description: "Open/activate selected item" },
  { key: "enter", modifiers: ["shift"], atomName: "highlight", description: "Highlight in editor" },
  { key: "c", modifiers: ["ctrl"], atomName: "copy", description: "Copy node content" },
  { key: "i", modifiers: ["ctrl"], atomName: "insert", description: "Insert after current line" },
  { key: "e", modifiers: ["ctrl"], atomName: "archive", description: "Archive/unarchive item" },
  { key: "arrowdown", modifiers: [], atomName: "arrowDown", description: "Navigate down" },
  { key: "arrowup", modifiers: [], atomName: "arrowUp", description: "Navigate up" },
]
```

**Add archiveActionAtom to ActionsMolecule:**

```typescript
const archiveActionAtom = atom(null, async (get, set) => {
  const actions = get(selectedTreeNodeActionsAtom)
  if (actions.length == 0) return
  
  const archiveAction = actions.find(it => 
    it.type === "browse" && 
    (it.url.includes("raycastaction=archive") || it.url.includes("raycastaction=unarchive"))
  )
  if (!archiveAction) return
  
  await set(executeActionAtom, archiveAction)
})
```

**Refactor KeyComboWrapper.handleKeyDown:**

```typescript
const handleKeyDown = async (event: React.KeyboardEvent<HTMLDivElement>) => {
  const eventModifiers: string[] = []
  if (event.ctrlKey) eventModifiers.push("ctrl")
  if (event.shiftKey) eventModifiers.push("shift")
  if (event.altKey) eventModifiers.push("alt")
  if (event.metaKey) eventModifiers.push("meta")
  
  const action = KEYBOARD_ACTIONS.find(a => 
    a.key.toLowerCase() === event.key.toLowerCase() &&
    a.modifiers.length === eventModifiers.length &&
    a.modifiers.every(m => eventModifiers.includes(m))
  )
  
  if (!action) return // no match, allow browser default
  
  event.preventDefault()
  
  const atomMap = {
    handleDefault: handleDefaultActionAtom,
    highlight: highlightSelectedItemAtom,
    copy: copyActionAtom,
    insert: insertActionAtom,
    archive: archiveActionAtom,
    arrowDown: arrowDownAtom,
    arrowUp: arrowUpAtom,
  }
  
  const atom = atomMap[action.atomName as keyof typeof atomMap]
  if (atom) {
    await executeAtom(atom)
  }
}
```

**Export Actions for Help Component:**

Export `KEYBOARD_ACTIONS` from `actions.tsx` so `SearchHelp` can import and display them.

### Search Help Component

**New File:** `src/view/search/SearchHelp.tsx`

**Component Structure:**

```typescript
import React from 'react'
import { KEYBOARD_ACTIONS } from '../react-context/actions'

export const SearchHelp = () => {
  return (
    <div className="search-help p-4 text-obs-base-40">
      <h3 className="text-lg font-semibold mb-4">Search Help</h3>
      
      {/* Section 1: Search Operators */}
      <div className="mb-6">
        <h4 className="font-semibold mb-2">Search Operators</h4>
        <ul className="space-y-1 text-sm font-mono">
          <li><code>:task</code> - Show only task items</li>
          <li><code>:page</code> - Show only pages</li>
          <li><code>:header</code> - Show only headers</li>
          <li><code>:folder</code> - Show only folders</li>
          <li><code>:emoji</code> - Show items with emojis</li>
          <li><code>:attachment</code> - Show attachments</li>
          <li><code>:word</code> or <code>:w</code> - Match whole words only</li>
          <li><code>"exact"</code> - Exact match (use quotes)</li>
          <li><code>-term</code> - Exclude term (NOT)</li>
          <li><code>term1 | term2</code> - OR operator</li>
          <li><code>parent / child</code> - Hierarchical search</li>
        </ul>
      </div>
      
      {/* Section 2: Keyboard Shortcuts */}
      <div className="mb-6">
        <h4 className="font-semibold mb-2">Keyboard Shortcuts</h4>
        <ul className="space-y-1 text-sm">
          {KEYBOARD_ACTIONS.map((action, i) => {
            const modifierStr = action.modifiers.map(m => 
              m.charAt(0).toUpperCase() + m.slice(1)
            ).join('+')
            const keyStr = action.key === 'arrowdown' ? '↓' :
                          action.key === 'arrowup' ? '↑' :
                          action.key.toUpperCase()
            const shortcut = modifierStr ? `${modifierStr}+${keyStr}` : keyStr
            
            return (
              <li key={i}>
                <code>{shortcut}</code> - {action.description}
              </li>
            )
          })}
        </ul>
      </div>
      
      {/* Section 3: Search Tips */}
      <div>
        <h4 className="font-semibold mb-2">Search Tips</h4>
        <ul className="space-y-1 text-sm">
          <li>Combine operators: <code>meeting :task</code> finds task items with "meeting"</li>
          <li>Use quotes for exact phrases: <code>"project plan"</code></li>
          <li>Exclude with minus: <code>report -draft</code></li>
          <li>Word boundaries: <code>cost :word</code> won't match "costly"</li>
          <li>OR search: <code>urgent | important</code></li>
          <li>Hierarchical: <code>Projects / 2024</code> searches within hierarchy</li>
        </ul>
      </div>
    </div>
  )
}
```

**Integration - Add helpVisibleAtom:**

In `SearchViewMolecule` (file: `src/view/react-context/state.tsx`):
```typescript
const helpVisibleAtom = atom(true)
```

**Integration - Add "?" Button to SearchBar:**

In `SearchBar.tsx`, add button next to the search icon:
```typescript
<button
  className="text-obs-base-40 focus:outline-none hover:text-obs-accent bg-transparent border-none p-1"
  aria-label="Toggle search help"
  onClick={() => setHelpVisible(!helpVisible)}
>
  ?
</button>
```

**Integration - Conditional Rendering in SearchViewFlatten:**

Modify `SearchViewFlatten` to check if help should be shown:
```typescript
const SearchViewFlatten = () => {
  const searchQuery = useAtomValue(searchQueryAtom)
  const helpVisible = useAtomValue(helpVisibleAtom)
  const searchResults = useAtomValue(searchResultsAtom)
  
  // Show help if: (empty query AND help is visible) OR (help explicitly toggled on)
  const shouldShowHelp = (searchQuery.query.trim() === '' && helpVisible) || 
                         (helpVisible && searchResults.length === 0)
  
  if (shouldShowHelp) {
    return <SearchHelp />
  }
  
  // ... existing results rendering
}
```

### Archive Refresh Fix

**Problem Analysis:**

When archiving/unarchiving items, the changes don't appear in search results until manual refresh because:
1. `archiveLine` modifies the file but doesn't trigger graph reindex
2. Parse cache isn't persisted after incremental updates
3. Debounced modify event may not fire immediately

**Solution - Three Parts:**

#### Part 1: Trigger Reindex After Archive Operations

Modify `executeActionAtom` in `src/view/react-context/actions.tsx`:

```typescript
const executeActionAtom = atom(null, async (get, set, action: RaycastAction) => {
  if (action.type === "browse" && action.keepOpen && action.location) {
    const app = get(appAtom)
    
    // Perform archive/unarchive
    if (action.url.includes("raycastaction=archive")) {
      await archiveLine(app, action.location)
    } else {
      await unarchiveLine(app, action.location)
    }
    
    // NEW: Trigger immediate reindex of the modified file
    const file = app.vault.getAbstractFileByPath(action.location.path)
    if (file instanceof TFile) {
      const triggerReindex = get(GlobalAtoms.triggerReindexAtom)
      if (triggerReindex) {
        await triggerReindex(file)
      }
    }
    
    return  // modal stays open
  }
  
  await executeAction(action)
  set(closeModalAtom)
})
```

#### Part 2: Add Reindex Trigger Atom

Add to `GlobalAtoms` in `src/view/react-context/global.tsx`:

```typescript
export const GlobalAtoms = {
  // ... existing atoms
  triggerReindexAtom: atom<((file: TFile) => Promise<void>) | null>(null),
}
```

Initialize in `main.ts` after creating `IndexedTree`:

```typescript
async onload() {
  // ... existing setup
  
  this.index = new IndexedTree(this.globalStore, this.manifest.dir);
  
  // NEW: Wire up reindex trigger
  this.globalStore.set(
    GlobalAtoms.triggerReindexAtom, 
    (file: TFile) => this.index.refreshPage(file)
  )
  
  // ... rest of setup
}
```

#### Part 3: Ensure Cache Persistence

Modify `IndexedTree.refreshPage` in `src/indexing/indexed-tree.ts`:

```typescript
async refreshPage(file: TFile): Promise<void> {
  try {
    const settings = getSettings(this.store)
    await reindexFileInGraph(
      file.path,
      this.graph,
      new ObsidianVaultScanner(this.vault, this.metadataCache),
      {
        parentRelation: settings.parentRelation,
        archiveTag: settings.archiveTag,
        searchSeparator: settings.searchSeparator,
      },
      this.parseCache,
    )
    
    // NEW: Persist cache after incremental reindex
    await this.saveCache()
    
    this.setState(this.graph)
  } catch (err) {
    console.warn(`[mdtree] Failed to reindex ${file.path}:`, err)
  }
}
```

**Data Flow:**

1. User presses Ctrl+E on a search result
2. `KeyComboWrapper` dispatches to `archiveActionAtom`
3. `archiveActionAtom` calls `executeActionAtom` with the archive action
4. `executeActionAtom` calls `archiveLine` (modifies file)
5. `executeActionAtom` triggers `refreshPage` via `triggerReindexAtom`
6. `refreshPage` reindexes the file and persists cache
7. `setState` increments `graphVersionAtom`
8. `searchResultsComputeAtom` (already subscribed to `graphVersionAtom`) recomputes
9. Search results update reactively, archived item disappears

## Testing Strategy

### Manual Testing

1. **Word Matching Operator:**
   - Search "cost :word" → should match "cost" but not "costly" or "Costin"
   - Search "ibm cost :w" → both terms should use word boundaries
   - Verify case-insensitivity

2. **Keyboard Shortcuts:**
   - Open search modal, navigate with arrow keys
   - Press Ctrl+E on an item → should archive and stay open
   - Press Ctrl+E on archived item → should unarchive
   - Verify other shortcuts still work (Ctrl+C, Ctrl+I, Shift+Enter)

3. **Search Help:**
   - Open search modal with empty query → help should appear
   - Type a query → help should disappear
   - Click "?" button → help should toggle on/off regardless of query
   - Verify all operators and shortcuts are documented

4. **Archive Refresh:**
   - Search for an item
   - Press Ctrl+E to archive it
   - Item should disappear immediately (no refresh needed)
   - Close and reopen plugin → item should still be archived
   - Test unarchive as well

### Integration Testing

- Verify archive + word search: archive items, search with `:word`, confirm archived items don't appear
- Test rapid archiving: archive multiple items quickly, all should update
- Test with slow disk I/O: ensure cache persistence doesn't block UI

## Migration and Rollout

### Breaking Changes
None. All changes are additive.

### Backwards Compatibility
- Existing shortcuts continue to work
- Existing search queries work unchanged
- `:word` is a new operator, won't affect existing queries

### Rollout Plan
1. Deploy to test vault
2. Verify archive refresh fix works
3. Test word matching with production data
4. Document new features in user docs
5. Release as minor version bump

## Future Enhancements

- User-configurable keyboard shortcuts (settings panel)
- More modifiers: `:created-today`, `:modified-week`, etc.
- Regex search operator
- Interactive help with copy-to-search examples
- Telemetry for which operators are most used
