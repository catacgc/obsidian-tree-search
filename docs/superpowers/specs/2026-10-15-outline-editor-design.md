# Outline editor (replaces the Patch view; used by Quick Add)

Approved 2026-10-15.

The Search modal and pane (`allowEditing`) get an **outline editor**: a browsable outline over the search results. Outline navigation always follows Explore behavior; direct row editing is a separate Alt+Enter action that does not open or switch the outline. The outline editor replaces the Patch view (the `>` append chain with row and entry chips, `ChainPreview` and the chain's own writes). The Alt+A **Append to [[P]]** editor (with its persisted `quickAddDraft`) and the prose whole-note editor stay as they are.

## Entry and exit

|Trigger|Behavior|Crumbs|
|---|---|---|
|Enter on a page, heading or line with children; the second click; a note link in a row; **Open**; the ⊕ patch dot; `>` on a row|Open the row's full tree (`advancedSearch(graph, key, "")`)|`search › ancestors… › Row` (`patchPath`)|
|Alt+Enter, Alt-click or the row-specific panel action on a selected row|Edit directly: a page's own resolved file opens Rename; a page-link row, heading or text row opens its source-line editor; an attachment opens Rename. The outline does not change.|unchanged|
|Quick Add command, Alt+N, the panel's **Quick Add**|Today (today's daily note outline), with a new line open|`search › Today`|
|`>` with nothing selected|Today, the new line pre-filled from the search (`chainPrefill`)|`search › Today`|
- Alt+Enter in the plain search requires a selection; inside the outline it uses Enter's row target (the first non-archive row when nothing is selected). The panel only exposes row-specific Edit/Rename when a row is selected.

- Inside the outline editor, the patch dot, a note link and `>` on a row descend: the row (with its tree ancestors in
  the outline) is added to the crumbs. A note link with no row for it replaces the path crumbs with `Note` (or
  `Note › Heading`).
- **Exit:** a click on the `search` crumb, Escape in the search input, or Backspace in an empty input with no crumb left
  to drop. The search comes back with the query typed before the outline editor and the row selected then.
- Leaving or changing the root with unsaved edits (an open line editor, a content buffer) shows a Notice once; doing it
  again discards them (the line editor's pasted attachments are trashed).

## Filtering

- The search input filters the outline live: the root's tree narrowed as `advancedSearch` narrows (a match keeps its
  subtree; its ancestors stay).
- Enter with text in the input and no row selected makes it a **filter crumb** (`search › Row › is:task`) and selects
  the first row; with a row selected, Enter runs its ordinary row intent and keeps the text in the input as a live filter.
  Crumbs AND together (each is a query stage). A click on a filter crumb drops the crumbs after it; a click on a path
  crumb makes it the root and drops the later crumbs and every filter crumb. Backspace in an empty input drops the last
  crumb (a filter crumb's text returns to the input; a path crumb moves the root up).
- Lines edited or added in this outline session are **pinned**: they stay listed when they stop matching, drawn with a
  red outline (`.ts-outline-miss`).
- Siblings are listed in file order (path, then line); every row is expanded, nothing compacted.
- With no filter and the search root, rows dim by the search query as in the search.

## Line editor

- Alt+Enter, Alt-click or the action panel's row-specific action edits the selected row directly, without opening an outline: a page's own resolved note file opens Rename, a page-link row edits its source link line, a heading or text row opens the line editor, and an attachment opens Rename. With no selected row, Alt+Enter does nothing.
- Ordinary Enter keeps its existing row intent: page/header rows and lines with children Explore; a line's URL, task, snippet or plain-leaf action remains unchanged. In the outline, Enter on a plain leaf line opens its source line editor; a second click on a row remains an Explore action.
- The source line is checked as before (`readLine` + list item or heading + `lineHasIdentity`, else the out-of-date Notice).
- The field's first line is the row's text without its indent, bullet, checkbox or `#…` prefix, which are kept. Alt+Enter
  adds a line (on the first line one level deeper: a child), Tab / Shift+Tab indent, Backspace on an empty line removes
  it. `[[` lists link targets (pages and headings, plus a New note row) under the field; `@` on an open task offers
  scheduled dates; Mod+B / Mod+I / Mod+K wrap; pasted lists become lines; pasted files are attachments named after the
  note at the caret (or the row's note) and renamed by alias on save; editor hints show under the field.
- Lines of the field that the crumbs would hide (`blockMisses`: per stage, neither the line, a line above or below it in
  the field, nor the row's tree context matches) get a red outline.
- **Save** (Enter, Mod+Enter or Shift+Enter): one `vault.process` per file through core `editOutlineBlock(content, line,
  expectedLine, first, extra)`. The line must still equal what was read (else `StaleLineError` → the out-of-date Notice).
  Deeper new lines go right after the line (before its existing children); same-depth lines (with their children) go
  after its subtree; under a heading every new line goes right after it. The first line gets Alt-Edit's
  `scheduleUnscheduledTasks` (not for a nested line); new lines are stamped (`stampNewOutlineLines`). The written lines
  are pinned, later pins in that file shift, the file is reindexed and the row flashes.
- **Escape:** closes the popups first; a changed field refuses once (Notice), a repeat discards it.
- A trailing **New line…** row opens the same editor on an empty `- ` line, written without editing an existing line:
  a note or heading root → today's daily note under `- [[P]]` / `- [[P#H]]` (`appendToDailyNote`); a line root → as its
  last children (`appendUnderLine`); the search and Today roots → today's daily note.

## Content pane

- The root's note text (a note: `noteBody`; a heading: `headingBody`; a line: its file's `noteBody`; Today: the daily
  note's), or while a page row, a link line or a heading row is edited that row's, is docked above the footer as an
  editable buffer (`writeNoteBody` / `writeHeadingBody`, `NOTE_BODY_CHANGED` guard). Enter on a page or heading explores its tree; the root's text appears in this pane. Alt+Enter on a page's own row opens Rename instead.
- Files pasted or dropped into it are attachments named after the note, renamed by alias on save, trashed on discard.
- Header buttons: Save, Open in Obsidian, expand (the pane fills the view), collapse (title bar only), close (hidden
  until another note is shown).
- Mod+Enter in the pane, the line editor or the search input saves the line editor and every changed buffer.

## Footer, panel, shortcuts, title

- Footer main item: with text in the input **Filter** (Enter); else the selected row's ordinary Enter action.
- Panel: Alt+Enter's action is **Rename** for a page's own row or an attachment, and **Edit** for a heading, text row or page-link line. No Edit action appears without a selected row; explicit **Rename [[Note]]** / **Rename ![[file]]** targets remain. In the outline editor the panel hides Append, Move under, Cut, the drawer, filters and Quick Add.
- Shortcut `edit` (Alt+Enter): renames the selected page or attachment, or edits its heading/list line directly; it does not open the outline.
- Modal title: `Explore <root>` (`Explore "<query>"` for the search root), `Quick Add` for a Quick Add session at Today.

## Model

- Core (pure, tested): `editOutlineBlock` (`edit/outline-edit.ts`); `lineNode(raw, path, line, nested)`,
  `lineMatches(node, stages)`, `blockMisses(lines, stages, context)`, `filterOutline(nodes, stages, pinned)`
  (`search/line-node.ts`); `flattenIndex(…, {fileOrder, expandAll})` and `ResultNode.miss` / `TreeNode.miss`.
- `SearchViewMolecule.outlineAtom: OutlineState | null` (`path`, `filters`, `prevQuery`, `returnTo`, `quickAdd`,
  `pins`), `lineEditAtom: LineEdit | null`, `outlineBodiesAtom`, `bodyAttachmentsAtom`, `paneAtom`; pure helpers in
  `src/view/search/outline.ts`. `ChainState` is the reparent chain only.
- `EditorMolecule`: `openOutlineAtom`, `editRowAtom`, `newLineAtom`, `saveOutlineAtom`, `cancelLineEditAtom`.

## Removed

The append chain and Patch view: row and entry chips, `chainResults` for append, `chainPatchRowAtom`,
`openPatchViewAtom`, `ChainPreview`, `chainWriteAtom`, `commitChainAtom`, `openChainEditorAtom`, `pasteIntoChainAtom`,
`pushChainAtom`, `parseChainEntry`, `chainOutline`, `chainEditorText`, the chip-less Quick Add chain
(`startQuickAddAtom`'s chain), the `{kind: "outline"}` editor request and `pendingPasteAtom`, and Alt-Edit list/heading
sessions (`openEditAtom`'s line edit, `editKind: "list" | "heading"`). Kept: the `<` reparent chain, drag reparent, the
cut drawer, attachment Rename, Save / Rename Filter, Alt+A Append with its draft, the prose editor.
