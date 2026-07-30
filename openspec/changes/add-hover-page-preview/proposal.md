## Why

The tree-search view lets you find notes and outline lines across the vault, but the only way to see the surrounding content of a result is to click through and open it, losing your place in the search. Obsidian users expect Cmd/Ctrl+hover to reveal a Page Preview popover everywhere links appear — the tree view is a conspicuous gap. Adding it lets users skim results in place without navigating away.

## What Changes

- Cmd/Ctrl+hovering a row in the tree-search view triggers Obsidian's native Page Preview popover.
- The preview target depends on what is under the cursor:
  - Hovering an `.obsidian-link` anchor (a page node or a `[[wikilink]]` token) previews the **actual linked note**, scrolled to its `#header` when the token carries one.
  - Hovering the row's empty space previews **`node.location`** — the file and line where the relation was recorded (the same target the existing shift+enter "See in Obsidian" highlight action opens).
- The tree-search view registers itself as a hover-link source so it gets a toggle under Settings → Page Preview and honors the "require modifier key" convention.
- Canvas-backed nodes (`location.canvasNode` present) are skipped — no preview is triggered.
- No custom preview UI is added; whatever Page Preview / Hover Editor the user already has installed renders the popover.

## Capabilities

### New Capabilities
- `hover-preview`: Cmd/Ctrl+hover over a tree-search result triggers the native Page Preview popover, targeting either the linked note (for wikilink anchors) or the relation's recorded location (for the row), and excludes canvas nodes.

### Modified Capabilities
<!-- No existing spec-level behavior changes. -->

## Impact

- `src/view/SearchTreeNode.tsx` — attach hover handling to the row for the "recorded location" case.
- `src/view/NodeRenderer.tsx` — attach hover handling to `.obsidian-link` anchors (page node render and `obsidian_link` token render) for the "linked note" case.
- `src/main.ts` — register the hover-link source (`registerHoverLinkSource`) so the view participates in Page Preview settings and mod-key gating.
- Depends on Obsidian's core Page Preview plugin (or a compatible community plugin such as Hover Editor); no new npm dependencies.
- **Open question / spike**: whether the native popover honors `state: { scroll: line }` to scroll to an arbitrary line for the row case (which has no heading anchor). If it does not, the row case falls back to previewing the note without line-scroll.
