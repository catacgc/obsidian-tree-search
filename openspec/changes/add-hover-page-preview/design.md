## Context

The tree-search React view renders results as rows (`src/view/SearchTreeNode.tsx`). Row content is produced by `src/view/NodeRenderer.tsx`, which emits `.obsidian-link` anchors for page nodes and `[[wikilink]]` tokens, and plain text for everything else. Every node carries a `location = { path, position: { start, end }, canvasNode? }` (`packages/core/src/graph/types.ts`). The Obsidian `App` is available in both components via `appAtom` (jotai) exposed through `GlobalAppMolecule` / `SearchViewMolecule`.

Clicking a row already navigates to the recorded location: the row click runs the shift+enter highlight action, which calls `getHighlightUrl(node.location)` → `highlightLine`. For the outline/text nodes that fill the tree, `node.location` is the exact line where the relation was written, so "recorded location" and "node location" coincide and no edge-threading through the flatten step is needed.

Obsidian's core Page Preview plugin renders its popover in response to the `hover-link` workspace event. Plugins opt in via `registerHoverLinkSource(id, { display, defaultMod })`, which also adds a per-source toggle in Settings → Page Preview.

## Goals / Non-Goals

**Goals:**
- Cmd/Ctrl+hover on a tree-search result shows a native Page Preview popover.
- Wikilink anchors preview the linked note (with `#header` when present); the row body previews the recorded location.
- Reuse the user's installed Page Preview / Hover Editor; add no custom preview UI and no new npm dependency.
- Exclude canvas-backed nodes.

**Non-Goals:**
- Building an in-view preview renderer.
- Changing click/keyboard navigation behavior.
- Threading edge-level locations through `flattenIndex` (the row already targets `node.location`, which is the recording site for tree nodes).
- Guaranteeing line-scroll fidelity if the underlying popover does not support it (see Open Questions / Risks).

## Decisions

### Trigger via `app.workspace.trigger("hover-link", …)`
Fire the standard event and let whatever preview plugin is installed render it:
```
app.workspace.trigger("hover-link", {
  event,            // native MouseEvent — carries metaKey/ctrlKey
  source: "tree-search",
  hoverParent,      // the view Component, for popover lifecycle
  targetEl,         // the hovered element
  linktext,         // note (+ optional #header) OR node.location.path
  sourcePath,       // for link resolution
  state,            // optional { scroll: line } for the row case
});
```
*Alternative considered:* calling `openLinkText`/opening a leaf ourselves — rejected because it navigates instead of previewing and duplicates Page Preview behavior.

### Register the source with `defaultMod: true`
In `main.ts`, `this.registerHoverLinkSource("tree-search", { display: "Tree Search", defaultMod: true })`. This expresses the "Cmd+Hover" intent through Obsidian's own convention and surfaces a settings toggle, rather than hard-coding key detection. We forward the native `event` so the modifier state travels with the trigger; the popover/gating logic reads it.
*Alternative considered:* manually checking `event.metaKey || event.ctrlKey` and always triggering — rejected as it ignores the user's Page Preview settings and duplicates platform logic.

### Two seams keyed on the hovered element
- `.obsidian-link` anchors in `NodeRenderer.tsx` (page-node render and `obsidian_link` token render) → `linktext = pageTarget (+ "#" + headerName)`, `sourcePath = pageTarget`.
- The row container in `SearchTreeNode.tsx` → `linktext = node.location.path`, `sourcePath = node.location.path`, `state = { scroll: node.location.position.start.line }`.
Anchor handlers take precedence naturally because the anchor is the innermost hovered element.
*Alternative considered:* a single row-level handler that inspects `event.target` to decide — workable but more brittle than attaching handlers where each element is already rendered.

### Skip canvas nodes early
If `location.canvasNode` is present, return before triggering. Native Page Preview cannot target a canvas node, and `highlightLine` already special-cases canvas for navigation.

## Risks / Trade-offs

- **Native popover may not honor `state: { scroll: line }` for an arbitrary line** → The row case has no heading/block anchor, only a line number. Mitigation: spike this early (below). If unsupported, degrade gracefully to previewing the note without line-scroll — the spec already allows this fallback. Anchor/wikilink previews are unaffected since they use heading anchors.
- **Behavior depends on an external plugin** → If neither core Page Preview nor a compatible plugin is enabled, nothing shows. Acceptable: this mirrors how links behave everywhere else in Obsidian.
- **`hoverParent` lifecycle** → Passing the wrong parent can leak popovers. Mitigation: use the view's Component so popovers are cleaned up with the leaf.

## Migration Plan

Additive, feature-flagged by the user's existing Page Preview settings; no data migration. Rollback is removing the hover handlers and the `registerHoverLinkSource` call.

## Open Questions

- ~~Does the `hover-link` event's `state: { scroll: line }` actually scroll the native popover to that line?~~ **RESOLVED (spike, live vault).** No — preview providers ignore an arbitrary line number. Both core Page Preview and Hover Editor derive the scroll target from a **subpath** (`#heading` / `#^block`) parsed out of the linktext: Hover Editor's `onLinkHover` runs `parseLinktext` → `buildEphemeralState` → `resolveSubpath(cache, subpath)`, and only sets `eState.line` when the subpath resolves; the payload `state` is never read. Obsidian has no raw-line anchor (`#L42`), and injecting a `#^block` id would mutate the file on hover, which is unacceptable.

  **Decision:** the row case appends the **nearest enclosing heading** as the subpath (`nearestHeadingSubpath`), giving section-level scroll across both providers with no file mutation; nodes above the first heading fall back to top-of-file. `state.scroll` is still passed for any provider that honors it.

  **Known limitation:** scroll lands on the node's *section*, not its exact line. Exact-line scroll would require either a block-id (mutation) or a fragile post-open `setEphemeralState` override on the created popover leaf — deferred unless section-level proves insufficient.
