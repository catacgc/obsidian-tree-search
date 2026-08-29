## Why

Daily notes accumulate scattered, ad-hoc mentions of a topic (`- [[Child]] http://some-url`, a bare `[[Child]]` nested under `[[Parent]]`, etc.) that the indexer already links together in the graph — but that structure only ever surfaces as a transient search result. There is no way to turn "everything the graph already knows is related to this note" into a permanent, de-duplicated outline on the note itself, so users either re-type the rollup by hand or leave the knowledge scattered across dated captures forever. "Pull children" lets a user consolidate a topic's graph subtree into the note in front of them in one action, then cleans up the now-redundant source lines.

## What Changes

- New Obsidian command, "Tree Search: Pull into this note", plus a matching row in the existing tree-search result action list (alongside Copy Node / Insert After / Archive) for a selected node.
- Running it builds the selected node's graph subtree (reusing the existing `buildTree` traversal), capped at 5 levels deep, with any node reachable via more than one path rendered once (first-encountered position wins).
- Before anything is written, a new preview modal shows the subtree as a tri-state checkbox tree. The user can uncheck any node (and its descendants) to exclude it. A node that already has an occurrence in the destination note is flagged in the preview; if left checked, its new children are appended under that existing line instead of duplicating the node at the cursor — this is what makes re-running the action on the same note idempotent instead of accumulating duplicates.
- On apply: checked lines are inserted verbatim (no rewriting of their text) at the cursor of whichever note is currently active, each with its recorded date appended (reconstructed from the node's `ageDays`, since no absolute timestamp is stored). Checked source lines are deleted from their origin file only if removing the pulled content leaves them fully empty (no remaining text or un-pulled children) — a source line with other content or children that weren't part of the pull is left untouched.
- New recursive tree-to-indented-markdown serializer (nothing today serializes more than a single node via `reverseMarkdownParsing`).

## Capabilities

### New Capabilities
- `pull-into-note`: selecting a node and running "Pull children" previews its graph subtree (depth-capped, deduped, merge-aware against the destination note) and, on confirmation, materializes the selected lines into the active note while removing source lines that become fully redundant.

### Modified Capabilities
<!-- No existing spec-level behavior changes; this adds a new action alongside existing ones without altering their behavior. -->

## Impact

- `packages/core/src/search/search.ts` — reuse/adapt `buildTree` for a depth-limited (5), node-deduped traversal starting from an arbitrary selected node.
- `packages/core/src/search/copy.ts` — add a recursive tree serializer (indented markdown, verbatim line text + appended date), alongside the existing single-node `reverseMarkdownParsing`.
- `packages/core/src/graph/boost.ts` — reuse `ageDays` to reconstruct an absolute display date (`today − ageDays`) for the appended provenance stamp; no new storage needed.
- `src/view/node-actions.ts` — new action type/entry for "Pull children" in the `RaycastAction` union and the tree-search result action list.
- `src/obsidian-utils.ts` — new vault-mutation functions: locate existing destination occurrences, insert (fresh or merged) at cursor/under an existing line, and delete now-empty source lines across however many files the subtree touched.
- `src/main.ts` — register the new Obsidian command and, if reused from the Raycast-style URI flow, a new `raycastaction` branch.
- `src/view/react-context/actions.tsx` — wire the new action into `ActionsMolecule`/`executeActionAtom` for the in-app panel.
- New UI component (no existing modal fits): a tri-state checkbox-tree preview modal, distinct from `SearchModal`/`QuickLinkModal`.
- No new external dependencies.
