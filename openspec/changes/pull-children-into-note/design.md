## Context

See proposal.md - Why / What Changes for motivation and scope. Relevant existing state:

- `packages/core/src/graph/indexer.ts` already turns a bare-wikilink bullet nested under another into a direct "parent"-type graph edge between the two page/header nodes (`createVirtualPage` collapse), and turns a link-plus-text line into a text node whose referenced page is its graph-parent (`createNodeFromText`). No new relationship-detection is needed; the graph already contains the relations this feature surfaces.
- `packages/core/src/search/search.ts` (`buildTree`) already performs an unbounded recursive traversal of outbound edges from a node, producing a `ResultNode` tree where every node's `location` is the exact source occurrence (file + line) that produced it, not a generic reference to the canonical node.
- `packages/core/src/search/copy.ts` (`reverseMarkdownParsing`) stringifies exactly one node's own line; nothing today serializes a tree.
- `packages/core/src/graph/boost.ts` stores only relative `ageDays`, derived at index time from either an embedded `YYYY-MM-DD` or the periodic-note resolver — both exact sources, so `today − ageDays` reconstructs the calendar date losslessly for display.
- `src/obsidian-utils.ts` `insertHere` is a blind cursor-position text paste with no awareness of existing file content; this is the precedent for "insert fresh," but merge-awareness (this change's Requirement: "flagged-and-still-checked node merges") has no precedent and is new ground.
- `src/view/node-actions.ts` / `src/view/react-context/actions.tsx` establish the pattern for adding a new action: a `RaycastAction` variant, a row in the result action list, and a handler in `executeActionAtom` (in-app) mirrored by a `raycastaction` URI branch in `src/main.ts` (external/Raycast trigger).

## Goals / Non-Goals

**Goals:**
- Reuse the existing traversal engine (`buildTree`) rather than building a second relationship model.
- Make the preview-and-select step a genuine gate: nothing touches disk until the user confirms.
- Make re-running the action on a note that already contains part of the subtree additive, not duplicative.

**Non-Goals:**
- No automatic conflict resolution beyond "does this node already occur in the destination" — no fuzzy text diffing, no reconciling manual edits made to a previously-pulled block.
- No support for pulling into a note other than the currently active one (canonical-file targeting, e.g. always writing to `[[Parent]]`'s own file regardless of cursor, is out of scope here).
- No undo affordance beyond the vault's own file history — the preview/select gate is the safety mechanism, not a custom undo stack.

## Decisions

**Traversal: wrap `buildTree`, don't fork it.** Add a depth-limited, node-deduped wrapper around the existing traversal (`packages/core/src/search/search.ts`) rather than duplicating edge-walking logic. Depth counts levels from the selected root (root = depth 0); traversal stops recursing past depth 5. Dedup is tracked by node key (`getKey`) for the duration of a single pull's traversal only — a `Set<string>` of already-placed keys, checked before descending into a child; first path wins, matching `buildTree`'s existing per-edge (not per-node) traversal guard, which otherwise permits the same node to appear once per incoming path (diamonds). This is a new, small wrapper — not a change to `buildTree`'s existing callers (`searchIndex`, `advancedSearch`), since they rely on the current unbounded/non-deduped behavior for other views.

**Date reconstruction happens at serialization time, not index time.** No new field is stored on nodes. The serializer computes `today − node.ageDays` (in whole days) when producing the display date for a pulled line. This keeps the graph/index untouched and treats the date purely as a presentation concern of this feature.

**New recursive serializer, separate from `reverseMarkdownParsing`.** A new function walks a candidate subtree and emits indented markdown, calling the existing single-node `reverseMarkdownParsing` for each line's own text (kept verbatim per the spec) and appending the reconstructed date. Kept separate from `reverseMarkdownParsing` itself so existing callers (Copy Node action) are unaffected.

**Merge detection: check destination occurrence per node before rendering the preview.** For each candidate node, look up whether the destination note's path appears among that node's known occurrences in the graph (an existing-edge/location lookup, not a fresh text scan of the file) to decide the "already present" flag and, if applicable, the existing line's location to merge under. Using the graph (already-indexed state) instead of re-parsing the destination file keeps this consistent with how the rest of the plugin treats the graph as the source of truth; it does mean the flag reflects the graph as of the last index refresh, not literally the current unsaved buffer — acceptable since the same staleness window already applies to every other tree-search result.

**Deletion emptiness check operates per source line against the confirmed selection.** After the user confirms, for each checked node, compare its source line's full original child set (from the pre-pull traversal, unbounded by this feature's depth-5 cap — i.e. re-derive whether the line has any children at all, not just any children within the pulled depth) against the checked set. A line deletes only if all of its children were checked (or it had none) and it carries no other text of its own beyond the pulled reference. This deliberately looks one level beyond the depth-5 cap so that a node with an un-pulled 6th-level descendant is correctly treated as "still has children" and is not deleted.

**New modal component for the checkbox tree, not a reuse of `SearchModal`/`QuickLinkModal`.** Neither existing modal has selection state or tri-state (checked/unchecked/indeterminate-via-partial-children) rendering; grafting that onto either would entangle unrelated concerns. The new modal is presentational plus a local selection-state map; it calls into the write/delete step only on confirm.

**Action wiring mirrors the existing pattern exactly.** New `RaycastAction` variant + row in `node-actions.ts`, new case in `executeActionAtom` (`actions.tsx`) for the in-app trigger, and — if the Raycast/URI path needs to support this action too — a new `raycastaction` branch in `main.ts`. This keeps the feature consistent with Archive/Insert rather than introducing a second action-dispatch mechanism.

## Risks / Trade-offs

- **[Risk]** Depth-5 traversal plus a per-node "does this occur in the destination" lookup could be slow on a large, densely-linked vault if run naively (O(subtree size × lookup cost)). → Mitigation: the destination-occurrence lookup only needs to run over the (small, depth-capped) candidate subtree, not the whole graph, and can reuse the same edge/location indexes `buildTree` already reads.
- **[Risk]** Graph staleness (destination "already present" flag computed from the last index refresh) could miss a line the user just typed and hasn't triggered a reindex for yet, causing an avoidable duplicate. → Mitigation: acceptable given existing plugin-wide staleness tolerance; documented as a known limitation rather than solved with a live-buffer scan.
- **[Risk]** The "children beyond depth 5" check for safe deletion requires looking one level past the traversal cap, which is an easy off-by-one to get wrong (deleting a source line that still has real, un-surfaced content). → Mitigation: covered explicitly by a spec scenario ("Source line partially consumed") and should be a dedicated test case, not just incidental coverage.
- **[Trade-off]** Choosing "insert fresh at cursor" for first-time pulls (rather than always targeting the node's own canonical file) means the resulting aggregation's location depends entirely on where the user happened to be when they triggered the action — consistent with the explicit decision to make this an "in-note" action, but it means a careless trigger could scatter aggregations across multiple notes instead of consolidating into one. No mitigation planned; this is the accepted shape of the feature.

## Migration Plan

Purely additive: a new command, a new action-list entry, a new modal, and new utility functions. No existing data, index format, or action behavior changes. Rollback is deleting/disabling the new command and action entry; no migration of stored state is needed since nothing new is persisted (the preview's selection state is transient, held only for the duration of one pull).
