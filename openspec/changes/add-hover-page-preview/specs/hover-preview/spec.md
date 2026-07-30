## ADDED Requirements

### Requirement: Cmd/Ctrl+hover triggers a page preview on tree-search rows

The tree-search view SHALL trigger Obsidian's native Page Preview popover when the user hovers a result row while holding the platform modifier key (Cmd on macOS, Ctrl elsewhere). The view SHALL register itself as a hover-link source so it appears as a toggle under Settings → Page Preview and participates in the "require modifier key" convention. The view SHALL forward the originating pointer event so downstream preview logic can read the modifier state, and SHALL NOT render its own preview UI — it reuses whichever Page Preview or compatible community plugin (e.g. Hover Editor) the user has installed.

#### Scenario: Modifier held while hovering a row
- **WHEN** the user moves the cursor over a tree-search result row with the modifier key held
- **THEN** the native Page Preview popover appears for that result

#### Scenario: No modifier held
- **WHEN** the user hovers a result row without the modifier key held and the "require modifier key" setting is active
- **THEN** no preview popover is shown

#### Scenario: Source registered in settings
- **WHEN** the user opens Settings → Page Preview
- **THEN** a toggle for the tree-search hover source is listed

### Requirement: Hovering a wikilink anchor previews the linked note

When the hovered target is an `.obsidian-link` anchor — a page node or a `[[wikilink]]` token — the preview SHALL target the actual linked note. When the token carries a header reference, the preview SHALL be scrolled to that `#header`.

#### Scenario: Hover a wikilink token
- **WHEN** the user modifier-hovers a `[[Note]]` token in a result
- **THEN** the preview shows the note `Note`

#### Scenario: Hover a wikilink token with a header
- **WHEN** the user modifier-hovers a `[[Note#Section]]` token
- **THEN** the preview shows `Note` scrolled to the `Section` heading

#### Scenario: Hover a page-node anchor
- **WHEN** the user modifier-hovers the anchor of a page-node row
- **THEN** the preview shows that page's note

### Requirement: Hovering the row body previews the relation's recorded location

When the hovered target is the row's empty space (not a link anchor), the preview SHALL target `node.location` — the file and line where the relation was recorded — matching the destination of the existing shift+enter "See in Obsidian" highlight action. The preview SHALL be scrolled to the recorded line when the preview mechanism supports scrolling to an arbitrary line; when it does not, the preview SHALL still show the note without line-scroll.

#### Scenario: Hover row empty space
- **WHEN** the user modifier-hovers the empty space of a result row whose relation is recorded at a given file and line
- **THEN** the preview shows that file, scrolled to the recorded line where line-scroll is supported

#### Scenario: Line-scroll unsupported
- **WHEN** the preview mechanism cannot scroll to an arbitrary line
- **THEN** the preview still shows the recorded file without line-scroll

### Requirement: Canvas-backed nodes are excluded from preview

When the hovered node's location targets a canvas node (`location.canvasNode` is present), the view SHALL NOT trigger a preview.

#### Scenario: Hover a canvas-backed node
- **WHEN** the user modifier-hovers a row whose location has `canvasNode` set
- **THEN** no preview popover is shown
