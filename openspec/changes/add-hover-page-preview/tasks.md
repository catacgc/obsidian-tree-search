## 1. Spike: line-scroll fidelity

- [x] 1.1 Spike (live vault): providers ignore raw `state.scroll`; both core preview and Hover Editor scroll only from a linktext subpath (`#heading`/`#^block`) via `resolveSubpath`
- [x] 1.2 Recorded in design.md; row case uses nearest-enclosing-heading subpath (section-level scroll, no file mutation) — exact-line deferred

## 2. Register the hover-link source

- [x] 2.1 In `src/main.ts` `onload`, call `registerHoverLinkSource("tree-search", { display: "Tree Search", defaultMod: true })`
- [ ] 2.2 Verify a "Tree Search" toggle appears under Settings → Page Preview — *needs live Obsidian*

## 3. Row-body preview (recorded location)

- [x] 3.1 In `src/view/SearchTreeNode.tsx`, add a hover handler on the row that reads `props.node.node.location` and `app` (via `appAtom`)
- [x] 3.2 Return early when `location.canvasNode` is present (no preview)
- [x] 3.3 Trigger `hover-link` with `linktext` = `location.path` + nearest-heading subpath (per spike), `sourcePath` = `location.path`, `targetEl` = the row element, `event` = the native pointer event, and `state: { scroll: line }`
- [x] 3.4 Pass a shared lightweight `hoverParent` (`{ hoverPopover: null }`) — *deviation: the ItemView isn't threaded into React; Page Preview dismisses popovers on mouse-out regardless, so a lightweight parent is sufficient*

## 4. Wikilink/anchor preview (linked note)

- [x] 4.1 In `src/view/NodeRenderer.tsx`, add a hover handler on the page-node `.obsidian-link` anchor targeting the page's note
- [x] 4.2 Add a hover handler on the `obsidian_link` token anchor targeting `pageTarget`, appending `#headerName` when the token carries one
- [x] 4.3 Ensure anchor handlers take precedence over the row handler (anchor is innermost) and do not double-trigger — *anchor handlers call `stopPropagation()`*

## 5. Verification

- [ ] 5.1 Cmd/Ctrl+hover a `[[wikilink]]` token → preview shows the linked note (and its `#header` when present) — *needs live Obsidian*
- [ ] 5.2 Cmd/Ctrl+hover a page-node anchor → preview shows the page's note — *needs live Obsidian*
- [ ] 5.3 Cmd/Ctrl+hover row empty space → preview shows the recorded file (line-scrolled per spike outcome) — *needs live Obsidian*
- [ ] 5.4 Hover without the modifier (with "require modifier" on) → no preview — *needs live Obsidian*
- [ ] 5.5 Cmd/Ctrl+hover a canvas-backed node → no preview — *needs live Obsidian*
- [x] 5.6 Typecheck/build passes and existing click/keyboard navigation is unchanged
