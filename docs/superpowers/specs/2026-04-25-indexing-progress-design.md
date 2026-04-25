# Indexing Progress Indicator

Show "indexed / total" progress in the Obsidian plugin search pane during full vault indexing.

## Approach

Add an optional `onProgress` callback to `buildGraphFromScanner`. The plugin passes a callback that updates a Jotai atom. The search view reads the atom and renders a progress indicator in place of the current loading dots.

## Core: `buildGraphFromScanner` callback

New exported type in `packages/core/src/graph/builder.ts`:

```ts
export type IndexProgress = { indexed: number; total: number }
```

`buildGraphFromScanner` gains an optional third parameter:

```ts
export async function buildGraphFromScanner(
  scanner: VaultScanner,
  settings: IndexSettings = DEFAULT_SETTINGS,
  onProgress?: (progress: IndexProgress) => void,
): Promise<NotesGraph>
```

The callback is invoked:
- Once after `walkVault()` returns, with `{ indexed: 0, total: files.length }`.
- At each batch boundary (every 10 files), with the current count.

No callback = no overhead. The CLI passes nothing and is unaffected.

Re-export `IndexProgress` from `packages/core/src/index.ts`.

## State: Jotai atom

In `src/view/react-context/global.tsx`, add:

```ts
const indexProgressAtom = atom<IndexProgress | null>(null)
```

`null` means "not currently indexing" (or the walk hasn't returned yet).

In `IndexedTree.refresh()`:
- Pass an `onProgress` callback that calls `this.store.set(GlobalAtoms.indexProgressAtom, progress)`.
- In the `finally` block, set the atom back to `null`.

## UI: progress indicator in search pane

In `SearchViewFlatten.tsx`, when `viewState.isLoading`:
- Read `indexProgressAtom`.
- If `null`: show the existing `LoadingDots` (vault walk in progress).
- If non-null: show "Indexing... {indexed} / {total}" with a thin progress bar underneath (a div whose width is `(indexed / total) * 100%`).

The progress bar uses a simple styled div with the accent color, no external dependencies.

## Files changed

| File | Change |
|------|--------|
| `packages/core/src/graph/builder.ts` | Add `IndexProgress` type, optional `onProgress` param, invoke at batch boundaries |
| `packages/core/src/index.ts` | Re-export `IndexProgress` |
| `src/view/react-context/global.tsx` | Add `indexProgressAtom` |
| `src/indexing/indexed-tree.ts` | Pass `onProgress` callback in `refresh()`, clear in `finally` |
| `src/view/search/SearchViewFlatten.tsx` | Read progress atom, render progress indicator |

## Out of scope

- Progress for incremental single-file reindex (too fast to matter).
- Status bar or Notice-based progress.
- CLI progress reporting.
