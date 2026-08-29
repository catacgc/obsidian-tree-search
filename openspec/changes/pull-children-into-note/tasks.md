## 1. Core traversal

- [ ] 1.1 Add a depth-limited (5 levels), node-deduped subtree builder in `packages/core/src/search/search.ts` that wraps `buildTree`, keyed by `getKey`, first-encountered-path wins
- [ ] 1.2 Unit tests: depth-6 chain truncates at 5; a diamond relation appears once at its first-encountered position; a plain single-child tree is unaffected

## 2. Date reconstruction and serialization

- [ ] 2.1 Add a helper that reconstructs a display date (`YYYY-MM-DD`) from a node's `ageDays` (`today − ageDays`)
- [ ] 2.2 Add a recursive tree-to-markdown serializer in `packages/core/src/search/copy.ts` (or a new sibling module) that renders each node via the existing `reverseMarkdownParsing`, appends the reconstructed date, and indents by depth
- [ ] 2.3 Unit tests: verbatim line text is preserved (no link stripping); date is appended to every line; indentation matches depth

## 3. Destination occurrence lookup (merge detection)

- [ ] 3.1 Add a lookup that, given a candidate node and a destination file path, determines whether that node already has a known occurrence in that file (via existing graph edges/locations) and returns its location if so
- [ ] 3.2 Unit tests: node with an existing occurrence in the destination is flagged with the correct location; node with no occurrence there is not flagged; node occurring only in unrelated files is not flagged

## 4. Non-aggressive deletion logic

- [ ] 4.1 Add a per-source-line "safe to delete" check: given a source line's full (unbounded) child set and the confirmed-checked set, the line is deletable only if every child was checked (or it had none) and it carries no other own text
- [ ] 4.2 Unit tests: fully-consumed line deletes; line with an un-pulled 6th-level descendant (beyond the depth-5 pull cap) is NOT deleted; line with unrelated own text is NOT deleted; a mention outside the pulled subtree entirely is untouched

## 5. Preview modal (new UI)

- [ ] 5.1 Build a new modal component rendering the candidate subtree as a checkbox tree, defaulting every node to checked
- [ ] 5.2 Implement unchecking a node cascading to (deselecting) its descendants
- [ ] 5.3 Render the "already present in destination" flag per node (from Task 3.1), including its existing location
- [ ] 5.4 Wire confirm/cancel: cancel performs no writes or deletes; confirm passes the final checked set forward
- [ ] 5.5 Manual verification in a real vault: preview renders correctly for a multi-level subtree with a mix of flagged and unflagged nodes

## 6. Write and delete execution

- [ ] 6.1 Add vault-mutation function(s) in `src/obsidian-utils.ts`: insert fresh content at the active cursor for unflagged checked nodes; append merged content under the existing line's location for flagged-and-checked nodes
- [ ] 6.2 Add vault-mutation function(s) to delete source lines that pass the Task 4.1 safety check, across every file touched by the confirmed selection
- [ ] 6.3 Sequence the apply step: write first, then delete, so a mid-operation failure never deletes content that wasn't successfully written
- [ ] 6.4 Manual verification in a real vault: reproduce the proposal's daily-note example end-to-end (nested `[[Parent]]`/`[[Child]]` plus two scattered `[[Child]]` mentions) and confirm the resulting note and the now-cleaned daily notes match expectations

## 7. Action wiring

- [ ] 7.1 Add a new `RaycastAction` variant (or extend the existing union) for "Pull children" in `src/view/node-actions.ts`, plus its row in the result action list
- [ ] 7.2 Register the new Obsidian command ("Tree Search: Pull into this note") in `src/main.ts`, invoking the same preview-then-apply flow as the action-list entry
- [ ] 7.3 Wire the new action into `ActionsMolecule`/`executeActionAtom` in `src/view/react-context/actions.tsx` so the in-app panel can trigger the preview modal
- [ ] 7.4 Existing test updates: extend `src/view/__tests__/node-actions.test.ts` for the new action entry

## 8. End-to-end verification

- [ ] 8.1 Re-run the full test suite (`packages/core` and plugin `src`) and confirm no regressions in existing traversal, copy, or action-list tests
- [ ] 8.2 Confirm idempotency: running "Pull children" twice in a row on a note that already received a prior pull, with new scattered captures added in between, results in one consolidated node with only the new children appended, not a duplicate
