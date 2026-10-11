# Negated terms exclude whole subtrees

Approved 2026-10-09 (option A: exclusions apply to the whole result).

## Behavior

- A negated term written at the top level of any stage (`-x`, `-(a | b)`, `-#tag`, `-is:…`, `-in:…`) is an **exclusion**. Every line, heading or note matching an exclusion is removed from the result tree together with everything under it, wherever it would appear: as a root, under another match, or as the path to a match.
- `parent . child -exclude` therefore shows `parent` with its `child …` lines, minus any line matching `exclude` and its subtree. A `child` line reachable only through an `exclude …` line is dropped, as is the `exclude …` line itself.
- The remaining (positive) terms of a stage match as before: a stage selects nodes beneath the previous stage's matches, and a matched node keeps its subtree (minus exclusions).
- A stage made only of negated terms (`a . -x`) contributes exclusions and no positive filter; its old behavior (prune matching subtrees below the previous stage) is the same, except that exclusions now reach every level.
- Behavior change: a first-stage exclusion also removes matching lines inside results. `is:page -is:text` now shows pages without their text lines, the same as `is:page . -is:text`.
- Nested lines are still shown inside their outline block (`liftToBlocks`). The rebuilt block omits excluded lines, and a match is dropped when any text line between it and its block root is excluded.
- Negations nested inside an OR (`a | -b`) are not exclusions; they keep matching as before. `-outline:`/`-[[note]]` and `-is:archived` are still dropped by `extractScope`/`extractArchiveReveal`.
- Applies to `searchIndex` and `advancedSearch`; Timeline, Raycast and inline code blocks consume their results.

## Model (`packages/core/src/search/search.ts`)

- `splitStage(expr)`: `{include, exclude}`; a top-level `not` or the `not` members of a top-level `and` go to `exclude`, the rest to `include` (`empty` when none).
- One predicate `excluded(node)` = any exclusion from any stage matches. The edge filter used to build result trees (`buildTree`, and `liftToBlocks`' block rebuild) skips edges whose target is excluded; first-stage candidates skip excluded nodes.
- `filterDown` matches only the positive parts and skips empty ones; `isNegation` and `filterTreeByWord`'s prune mode are removed.
- `firstPassInclude` (query.ts) is removed: the first stage's positive part never has a top-level `not`, so candidates use `matchQuery`.

## Tests

Integration fixture `exclude-subtree/` covering a mixed stage, the path-through-excluded case, and a lifted nested match under an excluded line. The `type-filters` test pinning "`is:page -is:text` keeps text lines" is updated to the new behavior.
