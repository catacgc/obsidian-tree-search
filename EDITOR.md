# Editor mode for Tree and Timeline results

Status: **implemented.** Read this document before changing result rows (`src/view/SearchTreeNode.tsx`, `src/view/search/SearchTimeline.tsx`, `src/view/search/SearchViewFlatten.tsx`) or adding vault writes. Where the implementation differs from the text below:

- **Task bullets** (`- [ ] buy milk`) are always indexed (`shouldSkip` keeps every non-empty task line), so they get no "Plain bullets aren't indexed" hint, in Append or Alt-Edit (`editorHints` reads the edited line's `linePrefix`).
- **Default schedule on save:** saving the Append outline or an Alt-Edit line gives every open, unscheduled task that is not nested under a text line `[scheduled:: <today>]` (`scheduleUnscheduledTasks`, `packages/core/src/edit/task-edit.ts`). An Alt-Edit of a nested line (`TextNode.nested`, `EditorState.nested`) adds nothing. Content sections are not changed.
- **Tab-indented notes:** lines written into a note whose list lines are tab-indented use one tab per level instead of 4 spaces, because `scanMarkdown` compares raw whitespace lengths.
- **Escape scope:** the editor's Obsidian `Scope` is pushed only while focus is inside the editor, so Escape elsewhere (a note, the search box) keeps its usual meaning.
- **Insert Link** hides archived targets with no "Archive (N)" row and ignores `is:archived` (it now calls `linkTargetTree`).
- **Action panel:** the footer bar and action panel (`docs/superpowers/specs/2026-09-30-search-actions-panel-design.md`) are the entry points on mobile and a keyboard/mouse alternative on desktop (§1, §3.1, §4.1, §5, §6, §8). The mobile long-press has not yet been checked on a device.
- **Task rows** (`docs/superpowers/specs/2026-10-06-task-actions-design.md`): the row checkbox (`TaskCheckbox`, Tree and Timeline, including the lines of a Timeline block row) and the action panel's Task section (Done, Today, Tomorrow, Weekend, Next Week) rewrite a task line through `editTaskLine` (`src/editing/vault-edits.ts`, pure transforms in `packages/core/src/edit/task-edit.ts`; `applyTaskEdit` applies them to the file content), with the Alt-Edit freshness rules (§5: `readLine` + `lineHasIdentity`, `StaleLineError` → the out-of-date Notice). Completing a task also completes the open tasks nested under it (deeper-indented lines that follow); scheduling and reopening touch only the line. Unlike the rest of this document, they work in every view with result rows, not only where `allowEditing` is on, except Quick Add's link list and Quick Link (pick mode). Open tasks sort first, oldest first (`compareOpenTasks`, `packages/core/src/search/task-order.ts`).
- **Hosts:** one editor, shown in place by the Search modal (scope name `"modal"`) and the Search pane (`"Search"`), and in its own modal by Quick Add (`tree-search:quick-add-modal`, scope name `"quickAdd"`). `GlobalAtoms.editorHostAtom` holds the scope name of the view showing it (null when none); a view shows it while `SearchViewMolecule.editorOpenAtom` (`allowEditing && editorHostAtom === name`). `SearchViewFlatten` then renders only `InlineEditor` (the editor plus its link results list, §3.4) instead of the search bar, results and footer, and `KeyComboWrapper` runs no Search shortcut, so editor keys never also act on the search. Quick Add reuses `SearchModal` with `SearchModalKind` `"quickAdd"` but renders only `QuickAddView` (`src/view/editor/QuickAddView.tsx`); its scope has `allowTimeline`/`allowEditing` false, and its `searchQueryAtom` starts at `{query: ""}`, never Search's last query. While a Search view shows the editor its Tree/Timeline mode is Tree and its recency window is ignored, so the link list is the full tree. The editor's first line is its title (`.ts-editor-title`, `editorTitle` in `src/view/editor/draft.ts`): `Add to <basename of today's daily note>`, `Add under "<line>"` for an Append under a picked line, `Edit <file basename>:<1-based line>` for an Alt-Edit session, `Write <note basename>` / `New note from <file basename>:<1-based line>` for prose.
- **Append draft:** the Append editor is a persistent draft in `appendDraftAtom` (`src/view/react-context/settings.ts`), saved in `data.json` as `quickAddDraft` (`PersistedDraft`: the `EditorState` minus `sessionId`/`mode`/`saving`; `draftToData`/`draftFromData` in `draft.ts`), shared by every host. `main.ts` saves it 500 ms (debounced) after each change and flushes on unload. It survives closing the editor, plugin reloads and restarts, and ends only on Save or Discard. An Alt-Edit or prose session lives in `GlobalAtoms.editSessionAtom`, is shown over the draft (which stays untouched), and is discarded when its editor closes. `EditorMolecule.editorStateAtom` derives edit session ?? draft; writes go to the slot matching the state's `mode`.
- **Editor requests** (`src/view/react-context/quick-add-flow.ts`): every editor entry point (`>`, ⊕, Alt+A/Alt+Enter/Alt+N, Alt-click, Insert After, the action panel's Append/Edit/Open editor, the commands) sends an `EditorRequest`, which `applyEditorRequestAtom` applies to the draft or session. In the Search modal or pane, `EditorMolecule.showEditorAtom` applies it and switches the view to the editor (`SearchViewMolecule.enterEditorAtom`); the Quick Add and Open editor commands go through `openQuickAddAtom`, which applies it and opens Quick Add (closing the Search modal if it is current). Requests:
  - `{kind: "draft"}`: show the draft, or start one with outline `- `;
  - `{kind: "link", name}`: keep the draft when it already appends to `name` (its `parentName`, case-insensitive, and no `underLine`); else replace it, trashing its pasted attachments, with a draft `- [[name]]\n    - ` (§4.1);
  - `{kind: "line", target}`: keep the draft when it already appends under that line (same path, line and text); else replace it, trashing its pasted attachments, with a draft `- ` whose `underLine` is the target (§6a);
  - `{kind: "outline", parentName?, underLine?, outline, caret}`: an append chain opened in the editor (§6a); always replaces the draft, trashing its pasted attachments;
  - `{kind: "session", state}`: a transient Alt-Edit or prose session over the draft.

  Every request also re-aims the draft's `sourcePath` at today's daily note. `enterEditorAtom` remembers the view's query and selected row (`editorReturnAtom`; a prose or Alt-Edit session opened from inside the editor keeps the first return point), and `leaveEditorAtom` restores them: closing the editor (Escape, Discard/Cancel) brings back the search with that query focused and selected (`GlobalAtoms.selectQueryAtom`, handled by `SearchBar`) and reselects the row it had; Save brings it back selecting the written row (`appendToDailyNote` / `appendUnderLine` report its line; else the picked line or `[[P]]` row; else row 0), revealed, scrolled to and flashed (`.ts-row-flash`, 1.5 s). When another view or Quick Add takes the editor, the view returns to its search without taking focus; closing the modal or pane frees the editor and the draft stays. Quick Add on Save opens the Search modal (with its last query), selecting and flashing the written row; closing it just closes. `QuickAddExit` is `{kind: "saved"} | {kind: "cancelled"}`.
- **Header roots:** in Tree mode, a header row with no page ancestor (promoted to a root by `pruneResultTree` because its page didn't match) appends to its own page (`appendTargetAt`), so it gets a ⊕ dot in every editing surface.

Editor mode lets you change the vault from search results without opening notes:

| Feature | Trigger | Tree | Timeline |
|---|---|---|---|
| Append | ⊕ dot at the bottom edge of a note's group, Alt+A, or **Append to [[P]]** in the action panel | yes | yes |
| Edit | hold **Alt/Option**: an edit hint appears; Alt+click or Alt+Enter, or **Edit line** in the action panel | yes | yes |
| Drag / reparent | drag a row onto another note row, or **Move under…** in the action panel | yes | no |

Append and Edit use the same inline editor. It has two sections:

- an **outline** section, always shown: you add to a bullet structure;
- a **content** section for free text, shown only after you click a note link.

Link autocomplete in both sections uses the Insert Link (Quick Link) tree, including headers, shown as Search results below the editor. You can paste files of any type. The pasted files are named after the note they are pasted under and are renamed on disk when you edit their alias.

## 1. Where it applies

- **Surfaces:** the Search pane (`tree-search:parse-tree`, scope name `"Search"`) and the Search modal (`tree-search:search-modal`, scope name `"modal"`) show the editor in place; Quick Add (`tree-search:quick-add-modal`, scope name `"quickAdd"`) shows it in its own modal (see "Hosts" at the top). Quick Link, File context, `tree-context` code blocks and the Consolidate notes pane stay read-only.
- **Gate:** `allowEditing: boolean` on `SearchViewScope` (`src/view/react-context/state.tsx`), defaulting to `false`. It is `true` in `SearchViewPanel.tsx` (`sectionName="Search"`) and in `SearchModalContainer.tsx` only for kind `"search"` (with `allowTimeline`); Insert Link and Quick Add have neither.
- **Excluded rows:** the synthetic Archive row appended by `updateSearchResultsAtom` has a fake location and never gets a ⊕, an edit hint or drag.
- **Mobile** (`Platform.isMobile`, since `isDesktopOnly` is `false`): the action panel is the entry point (spec `2026-09-30-search-actions-panel-design.md` §4).
  - A tap selects a row; the footer then offers its main action and **Actions**. A long-press (500 ms) on any row selects it and opens the action panel.
  - No ⊕ dots are shown. Append is **Append to [[P]]** in the panel.
  - Edit is **Edit line** in the panel; a long-press no longer opens it directly.
  - Drag is disabled, because HTML5 drag-and-drop does not work with touch. **Move under…** in the panel moves a row under another page in the current results, with the same rule and write path as a drop (§6).

## 2. Constraints from the current index (why the rules below look the way they do)

- **Flat rows.** Results are a flat list of rows (`TreeNode`, `SearchViewFlatten.tsx:12-22`). There is no card or group element.
  - In Tree mode, a group is a row at indent `k` plus the rows after it with indent `> k`.
  - Timeline rows are all indent 0. Each has a `breadcrumb` (matched ancestors, else the in-note parent from `fileParent`, `packages/core/src/search/timeline.ts:73`).
- **Row location is where the relation was written, not the node's own file.** `buildTree` replaces a child's `location` with the edge location (`packages/core/src/search/search.ts`). A child row usually points to a bullet line in some other note, often a daily note.
  - Only one edge is kept per (parent, child) pair, and the first indexed file wins, so the location may point to an older daily note.
  - Root rows keep the node's own location (a page's file, line 0).
- **Parent edges come from four sources** (`packages/core/src/graph/indexer.ts`):
  - bullet nesting;
  - a `[[link]]` inside a bullet (the linked page becomes a parent of that line);
  - headings (a heading's parent is the enclosing heading, else the page; root bullets under a heading hang off that heading);
  - frontmatter `parent` (setting `parentRelation`).
- **Only the leading outline is indexed.** `scanMarkdown` (`packages/core/src/parser/list-scanner.ts`) stops collecting bullets at the first non-neutral body line (prose, `**Bold:**`, URL line, `#tag` line, quote, table, fence, embed, `---`). Headings are indexed everywhere. New bullets must be inserted **inside** the leading outline, or they will never show up. This is why free text goes into a note's content and not between bullets.
- **Prose-only bullets are not nodes.** A bullet without `[[`, `#`, `http` or a task checkbox is skipped (`shouldSkip`). Its nested bullets attach to its parent.
- **The raw line is not stored on the node.** Text nodes carry `searchKey` and `parsedTokens` only. Editors must read the file at `location.position.start.line`, as `archiveLine` does (`src/obsidian-utils.ts:234`).
- **Reindexing:**
  - One shared 200 ms `debounce` on `vault.on('modify')` feeds `IndexedTree.refreshPage` (`src/main.ts:162-170`). Two files written within 200 ms can lose a reindex.
  - There is no `create` handler.
  - So every editor write must explicitly `await index.refreshPage(file)` for **each** markdown file it created or modified, one after another. `IndexedTree` is not reachable from React today: add `indexAtom = atom<IndexedTree | null>(null)` to `GlobalAtoms` (`src/view/react-context/global.tsx`) and set it in `onload` right after `this.index` is constructed.
- **Daily notes:**
  - The only daily-note code is `IndexedTree.loadPeriodicResolver` (`src/indexing/indexed-tree.ts:61-69`), which reads `${configDir}/daily-notes.json` `{folder, format}` for dating.
  - Keep the parsed config (including `template`) on the instance and expose `getDailyNoteConfig(): { folder: string; format: string; template: string }`. Defaults are `""`, `"YYYY-MM-DD"` and `""`.
- **Insert Link already has the target tree.** `SearchModalMolecule` (`src/view/react-context/state.tsx:135-160`) runs `searchIndex`, then, when `isQuickLink`, keeps only `page` and `header` nodes whose own key matches every query term (`pruneResultTree`), then hides archived rows (`partitionArchived`). `searchIndex` returns nothing for queries shorter than 3 characters. Accepting a row inserts `reverseMarkdownParsing(node)` (`packages/core/src/search/copy.ts`): `[[Page]]` or `[[Page#Header]]`.

## 3. The inline editor (shared by Append and Edit)

### 3.1 Layout

**Placement:** one editor (see "Hosts" at the top): at the **top of the Quick Add modal body**, or replacing the search in the Search modal or pane, with the link results list (§3.4) filling the space below it. The editor is not boxed: it paints the view's tone (`--ts-surface`: `--modal-background` in the modal, else `--background-primary`; set on `.ts-search-view` in `styles.css`). The text fields keep a 1 px `--background-modifier-border` border turning `--background-modifier-border-hover` on hover/focus, with no focus ring; the buttons are plain text (Save in the accent color). Its first line is the title naming the target (`editorTitle`). Append's parent is the outline's first bullet (§3.2).

From top to bottom:

1. **Outline section**: a markdown field, always shown (§3.2).
2. **Content section**: a second markdown field, shown only after a note link is clicked (§3.3).
3. **Mobile toolbar** (`Platform.isMobile` only): icon buttons acting on the last focused field (§3.9).
4. **Preview**: a live preview of the focused section, rendered with `MarkdownRenderer.render` and at most 6 lines. It reuses the `MarkdownLine` component from `src/view/organise-notes/PullTreeView.tsx`. Move `MarkdownLine` to `src/view/editor/MarkdownLine.tsx` and import it from both places. Pasted attachments are already on disk (§3.5), so their embeds render in the preview; images show as thumbnails of at most 64×48 px (`editor.css`).
5. **Footer hints** (§3.6).

The fields never render embeds: every `![[…]]` widget (image, PDF, note) shows its link text `![[name]]`, muted, and is hidden while live preview reveals the embed's source (`.cm-formatting-embed`) on the caret line (`editor.css`).

Both fields are `MarkdownField` (`src/view/editor/MarkdownField.tsx`): Obsidian's own markdown editor (CodeMirror 6 with live preview), recovered from a throwaway markdown embed in `src/view/editor/obsidian-editor.ts` the way the Kanban plugin does it (private API; if a future Obsidian removes it, the editor shows a Notice and has no fields). The editor sees a proxied `app` that hides line numbers and fold indicators, ignores the editor's `workspace.activeEditor = owner` on focus (so the field never becomes the active editor), and hands it an inert `workspace.editorSuggest` (so Obsidian's own `[[` suggest and other plugins' editor suggests never open; links use the results list, §3.4). Obsidian's hotkeys still see a focused CodeMirror field as an editor, so the editor's keys are claimed first in its Scope (§3.6). Capture listeners on the field's host run before CodeMirror and Obsidian: the owner handles file pastes and drops (§3.5), outline text pastes (§3.2) and link clicks (§3.3); Obsidian never opens a link clicked in the field. Other keys stay inside the field, except Escape. Enter that arrives through CodeMirror's keymap rather than a keydown (e.g. from an Android keyboard) gets the same outline handling. Each field starts at one line and grows up to 8 lines, then scrolls. The content field is re-created per buffer, so undo never crosses buffers. The outline gets focus on mount, with the caret restored from `EditorState.caret` (the outline caret, kept in the state and persisted with the draft). Only one editor is shown at a time: an Alt-Edit session hides the draft until it ends (§3.7).

### 3.2 Outline section

The outline holds the bullets that Append writes under the parent (§4) or the single line that Edit rewrites (§5).

- **Append** starts prefilled with the parent as its first bullet, `- [[P]]\n    - `, and the caret at the end, when no draft exists; with a draft, picking a parent inserts `[[P]]` at the draft's caret instead (§4.1). The user may delete or change the parent line. The blank draft (§4.1) starts with `- `. Every line is a bullet: 4 spaces per level, then `- ` (or `- [ ] `/`- [x] ` for tasks), then text. The outline is always a list: whatever changes the text (keys, soft keyboard, deleting a selection, cut, undo, paste, programmatic edits), a `MarkdownField` `repair` transaction filter (`outlineRepairs`) gives every line without a marker `- ` after its indent and a bare marker its space, in the same transaction (one undo step). `*`, `+` and `1.` markers count as list lines. Rules:
  - Enter on the first line starts a child bullet one level (4 spaces) deeper, so the top line becomes the parent of what follows; Enter on any other line starts a sibling bullet at the same indent. Text after the caret moves to the new bullet.
  - Tab and Shift+Tab indent and outdent the current bullet by 4 spaces, but never deeper than the previous line's indent + 4.
  - Backspace (empty selection, `outlineBackspace`), handled both on keydown and in CodeMirror's keymap (Android keyboards send no keydown):
    - on a line (not the first) that holds only an indent and a bare marker (`-`, `*`, `+`, optionally `[ ]`/`[x]`), it deletes the whole line and puts the caret at the end of the previous line;
    - with the caret inside or right after a line's prefix (indent, marker, checkbox), it drops a checkbox (caret after the marker); else a non-first line joins the end of the previous line (no space added; the caret lands at the join); the first line keeps its marker (caret to its text start).
  - Pasted text (`pasteOutline`) is converted from the clipboard's HTML to markdown when Obsidian's "Auto convert HTML" setting is on (Mod+Shift+V pastes the plain text), so nested lists keep their structure. Blank lines are dropped, plain lines get a `- ` prefix, and indents (tabs, 2/3/4-space units) become 4-space levels relative to the first pasted line. At a bare bullet the first line fills it and the rest follow at the caret line's indent; a single line is inserted inline without its marker; on a blank line the block replaces it; otherwise the block goes below the caret line as its siblings.
  - On save, empty bullets are dropped.
- **Edit** shows only the editable part of one line (§5). Enter saves, and the line cannot be split: pasted line breaks become spaces.
- **Text-only appends are not allowed.** An Append needs at least one non-empty bullet beyond the untouched prefilled `- [[P]]` line (`appendOutlineEmpty`, which compares the root's raw text, so `- [[P|alias]]` or `- [[P]] (is:: x)` is content). Otherwise Save is disabled, with no hint.
- Bullets may be plain text. They are written, but the footer warns that they won't show up in results. Task bullets are always indexed and get no warning.
- A line whose text is a heading (`^#{1,6}\s+\S`) blocks Save. Headings belong in a note's content section.

### 3.3 Content section

The content section edits the free-text **content of one note**. It is hidden until the user opens it for a note:

- by clicking a `[[X]]` or `[[X#Header]]` link rendered in the outline field (a `.cm-hmd-internal-link` span; the link around its position is used);
- or with Alt+Enter while the caret is on an outline line: this opens the link under the caret, else the first link on the line, else (in Append) the parent `P`.

Only the page part `X` of the link is used, and headers are ignored. Mod+click on a link opens the note in Obsidian instead, as in the rest of the plugin.

Behavior:
- **Header:** `Content for [[X]]` with a ✕ button. ✕ clears X's buffer and hides the section.
- **Buffers:** there is one text buffer per note name, kept until the editor closes. Clicking another link switches the section to that note's buffer. Notes whose buffer is not empty are shown as small chips (`[[X]]`, `[[Y]]`) in the section header, and clicking a chip switches to that buffer.
- **Text:** free markdown, written verbatim. It can include paragraphs, headings, prose, quotes, tables and embeds. Editing is Obsidian's own: Enter continues lists, Tab follows the vault's indent settings, and pasted HTML converts per "Auto convert HTML".
- **Where it goes on save** (§4.2): if `X` has no file, the text becomes the body of a new `X.md`. Otherwise it is appended at the end of `X`'s file.

### 3.4 Link autocomplete: Insert Link results below the editor

It works in both sections.

**Trigger:** `useLinkSuggest` (`src/view/editor/LinkSuggest.tsx`) tracks only the open `[[query`: the text between the last unclosed `[[` before the caret and the caret (`open`, `start`, `query`, `dismiss`). The list opens as soon as `[[` is typed. `InlineEditor` sets the Quick Add scope's `searchQueryAtom` to `[[query` (the query language's open link, see below), or to `quickAddDefaultQuery(caretParent)` (`state.tsx`) when none is open: `[[P]]` when the outline has a caret note `P` whose name has no `[`/`]`, else `DAILY_OUTLINE_QUERY` (`:daily :page`). The **caret note** is `caretNote(outline, caret)` (`textarea-ops.ts`), in Append and Alt-Edit alike, read from the live text and the outline's caret (kept while the content section is focused): on the caret's line, the last non-embed link starting before the caret, else the line's first link (in `[[A]] … [[B]]`, a caret before or inside `A` or between the two gives `A`; inside or after `B` gives `B`); on a line without a link, the nearest ancestor line (smaller indent) that has one, using its last link; else none. So the prefilled `- [[P]]\n    - ` gives `P`, and the list switches as the caret moves to another link or that link changes (once its `[[` is closed).

**Default list (no open `[[`):** `SearchModalMolecule` runs Quick Add's query through `searchIndex` with `IndexedTree.searchOptions()`, like Search. With a caret note `P` the list shows `P`'s full tree: everything Search shows under `P`, including children written in other notes (`[[P]]` scope, see below). Without one (a blank draft, a root line without a link, a name containing `[` or `]`) it shows today's daily note as one tree: its headings and bullets exactly as written in that file (`outline:` scope), with linked notes' own children left out. Picking a page or heading row inserts its link at the caret (`insertAtCaret`, then `ensureBullet` in the Append outline); text rows aren't pickable, and the keys below stay inactive. An empty list shows `No results for [[P]]`, or without a caret note `Today's daily note has no outline yet`.

**`outline:<note>` / `:daily` / `[[note]]` / `[[note#heading]]`** (`packages/core/src/search/query.ts`, `search.ts`): search scopes, not node matchers. The tokenizer reads a closed `[[name]]` (alias after `|` dropped) as one exact `tree` modifier; there is no typeable `tree:` operator. `extractScope` strips them from the stages. `outline:` limits candidates to the nodes reachable from the note's page through outline edges and builds trees along those edges only. An outline edge is a `parent` edge recorded in that file, excluding the link edges from each page/header a line links to (`linkTargetKeys`). `[[note]]` limits them to the nodes reachable from the note's page along the edges the search follows anyway (all but folder edges, unless the query targets folders), recorded in any file; it also targets link-only (reference) notes. `[[note#heading]]` roots that at the heading's node (an unknown heading matches nothing). Both present: their key sets intersect and only edges both allow are followed. Picking the note (`pickNotes`, case-insensitive): a quoted `outline:"name"` (spaces and the separator allowed) or a `[[name]]` is exact, matching every note whose name or vault path (with or without `.md`) equals it. A bare `outline:sep` picks one note: the one named exactly `sep` if any, else the most recent note whose name contains it (whose path does, when it has a `/`). Most recent means lowest `ageDays`, then latest file mtime, then path. Reference notes match by name only. `:daily` targets `SearchOptions.dailyNote` exactly: `IndexedTree.searchOptions()` in the plugin, the vault's `daily-notes.json` in the CLI. Without one, `:daily` matches nothing.

**Open `[[fragment`** (`openLinkAt`: the query's last `[[` with no `]]` after it): `searchIndex` returns `linkTargetTree(graph, fragment, separator)` and ignores the rest of the query, on every surface (Search, Quick Add, Raycast, code blocks, CLI). In the Search modal and pane, Enter or Tab on a note/heading row replaces the open `[[fragment` with the row's link (`SearchBar`'s `handleLinkKey`), which then shows that tree; not in Insert Link or during a Move to (`<`).

**Results:** the same pipeline as Insert Link, so both surfaces offer the same targets:
- `linkTargetTree(graph, query, separator): ResultNode[]` in `packages/core/src/search/search.ts` runs `searchIndex` → `pruneResultTree` (keep `page`/`header` nodes whose own key matches the AND of all query stages) → `partitionArchived(…, reveal = false).visible`.
- `SearchModalMolecule` calls it directly for Insert Link (typed without `[[`); Quick Add's `[[query` reaches it through `searchIndex`'s open-link case.
- Hierarchical queries (for example `proj<separator>kick` with the `searchSeparator` setting) work the same way as in Insert Link.

**Rendering:** `LinkResults` (`LinkSuggest.tsx`) fills the modal body below the editor (`.ts-link-results`) and draws the rows with `SearchTreeNode`, like Search results: tree indent/guides, collapse, match highlighting, selection highlight (row 0 selected by default) and Load More. Otherwise it shows one muted line `.ts-link-results-empty`: `Today's daily note has no outline yet` (no open `[[`), `Type 3+ characters`, or `No matching notes`.

**New note row:** while a `[[query` is open, `.ts-link-new` (**New note `[[<query>]]`**) sits above the rows and above the empty line. `newLinkName(graph, query, targets)` (`search.ts`) names it: the trimmed query, or null (no row) when it is blank, holds `#`, `^`, `[`, `]` or a character `INVALID_NAME_RE` rejects, names a page in the graph (file or reference, archived included), or equals an alias of a page in the link-target list (`lastResultsAtom`). It is selected exactly when no result row is (`selectedLineAtom` −1): with no rows, or after ArrowUp from the first row. The best match stays selected by default (`settleSelection` picks row 0 on every recompute, a reindex included). The name is inserted as typed, not in an existing note's case. Picking it only inserts `[[<query>]]` (Accept below); the file is still created only when content is entered for it (§4.2).

**Keys** (while a `[[` is open and there are rows or a New note row): ArrowUp/ArrowDown move the search selection (`arrowUpAtom`/`arrowDownAtom`), ArrowUp from the first row selects the New note row and ArrowDown from it the first row; with no rows the arrows move the caret. Enter or Tab accepts the selected row or the New note row (Shift+Enter still saves, Shift+Tab still outdents), and Escape dismisses the open `[[`. A click picks a row (`SearchTreeNode`'s `onPick` prop: a capture-phase click beats row links, mousedown `preventDefault` keeps the editor focused; the guides' expand click still works).

**Accept:** replace the text from `[[` to the caret, plus a directly following `]]` if there is one, with `reverseMarkdownParsing(node)`, which gives `[[Page]]` or `[[Page#Header]]` (the New note row: `[[<query>]]`). The caret goes after the closing `]]`. In the Append outline, `ensureBullet` then keeps the caret line a list item.

### 3.5 Pasting attachments

A paste whose `clipboardData.files` is not empty is handled by the editor (`preventDefault`) in either section. **Any file type** is accepted. Each file is **written to disk immediately**. A text paste that is a single URL is handled by §3.8.

**Base note** (whose name the attachment is named after):
- Append outline: the caret note (`caretNote`, §3.4), else the parent `P`.
- Edit line: the caret note on the line, else the basename of the row's `location.path`.
- Content section: the section's note `X`.

**Name:** `<slug(base)>-<kind>-<N>.<ext>`.
- `slug`: NFKD-normalize, strip diacritics, lowercase, replace each run of characters outside `[a-z0-9]` with `-`, and trim `-`. An empty result becomes `attachment`. For example, `New page` becomes `new-page`.
- `kind`: `image`, `audio` or `video` from the MIME top-level type, else `file`.
- `ext`: the extension of the pasted file's name, else one derived from the MIME subtype (`image/png` gives `png`), else `bin`.
- `N`: the smallest integer ≥ 1 such that no vault file has that basename (`metadataCache.getFirstLinkpathDest(name, "") == null`) and no other attachment pasted in this editor uses it. A vault-unique basename keeps the bare `![[name]]` embed unambiguous.

**Write:**
1. `path = await app.fileManager.getAvailablePathForAttachment(name, sourcePath)`. This follows the user's attachment-folder setting. `sourcePath` is today's daily note path for Append, the row's `location.path` for Edit, or `X`'s path (or its future path) for the content section.
2. `app.vault.createBinary(path, await file.arrayBuffer())`.
3. Record `{ file: TFile, ext, kind }` in the editor's **session attachments**.

**Inserted text:**
- Outline in Append: one new bullet `- ![[name]]` per file, one level deeper than the caret's line. If the caret's line is an empty bullet, the first file fills that bullet.
- Edit line and content section: `![[name]]` at the caret, with files separated by a space (Edit) or a newline (content).

A write failure shows a Notice, and nothing is inserted for that file.

**Example.** Pasting a PNG and a PDF on the line `    - [[New page]]` gives:

```markdown
    - [[New page]]
        - ![[new-page-image-1.png]]
        - ![[new-page-file-1.pdf]]
```

**Renaming by alias.** The user renames an attachment by editing its embed, usually by adding an alias: `![[new-page-image-1.png|New Alias Text]]`. On save (step 1 of §4.2 and §5), the pure function `resolveAttachmentEmbeds` does the following:

1. It collects every `![[target]]` / `![[target|alias]]` embed in the outline and in all content buffers.
2. It matches embeds to session attachments:
   - An embed matches if its target equals the attachment's current name.
   - An embed that still has no match and whose target resolves to no vault file matches the one remaining session attachment with the same extension (any extension if the target has none). So `![[new-age-image-1.png|New Alias Text]]`, where the file name has a typo, still matches `new-page-image-1.png`.
   - If more than one attachment could match, Save is blocked with the hint `Can't tell which attachment ![[target]] is — restore its file name and change the alias instead`.
3. It picks the desired name for each matched attachment:
   - With an alias: `slug(alias) + "." + ext`, for example `new-alias-text.png`.
   - Without an alias: the typed target, with `.ext` added if the target has no extension.
   - If the name is taken by another vault file or another session attachment, it appends `-2`, `-3`, … before the extension.
   - If several embeds match the same attachment, the first one in document order decides its name.
4. It renames each attachment whose desired name differs, with `app.fileManager.renameFile(file, <same folder>/<desired>)`, and rewrites every matching embed in the buffers to `![[desired]]` or `![[desired|alias]]`, keeping the alias verbatim. So `![[new-age-image-1.png|New Alias Text]]` becomes `![[new-alias-text.png|New Alias Text]]`, and the file becomes `new-alias-text.png`.
5. It trashes session attachments that no embed matches, with `app.fileManager.trashFile(file)`, which respects the user's trash setting.

Desired names follow the filename rule in §7.

### 3.6 Keys

The editor's keys go through `onKeyDown`, first from a catch-all handler in the editor's Obsidian Scope (it runs before Obsidian's hotkeys, which would otherwise run editor commands such as `editor:toggle-bold` or `editor:follow-link` on the field), then from the field's host capture listener. A handled key never reaches CodeMirror; an unhandled one goes to CodeMirror and Obsidian. The field stops every key but Escape from bubbling, so `KeyComboWrapper` never sees them. Keys during an IME composition are left to the IME. An open autocomplete list takes precedence (§3.4).

| Key | Outline | Content |
|---|---|---|
| Enter | Append: on the first line a child bullet, else a sibling bullet. Edit: save. | Obsidian (continues lists) |
| Mod+Enter / Shift+Enter | Save | Save |
| Tab / Shift+Tab | Append: indent / outdent the bullet. Edit: Obsidian | Obsidian |
| Backspace | Append: on a bare-bullet line, delete the whole line; in a line's prefix, drop its checkbox or join the previous line; the first line's marker stays (§3.2) | Obsidian |
| Alt+Enter | Open the content section for the link at or near the caret (§3.3); on an Append line without a link, the whole-note prose editor (§6a) | Not handled (goes to Obsidian) |
| Escape | Dismiss an open `[[` suggestion; else close the editor, keeping the Append draft (an Alt-Edit or prose session is discarded): Quick Add closes, a Search view returns to its search | Hide the section and return focus to the outline (the buffer is kept) |
| Mod+B / Mod+I | Wrap the selection in `**…**` / `*…*` | same |
| Mod+K | Wrap the selection as `[selection](url)` and select `url` | same |

Escape inside the editor is handled by the editor first. While focus is inside the editor, it pushes an Obsidian `Scope` with `app.keymap.pushScope(scope)`, registers `scope.register([], "Escape", () => { handleEscape(); return false })` plus the catch-all key handler above, and pops it on blur and unmount.

### 3.7 Hints, errors, save and cancel

**Footer hints:** a muted footer, recomputed on each change. Blocking hints disable Save. An empty Append outline (§3.2) also disables Save, without a hint.

| Condition | Hint | Blocks save |
|---|---|---|
| Outline line is a heading | `Headings go in a note's content — click [[P]]` (`click a [[link]]` when there is no parent) | yes |
| Ambiguous attachment embed | see §3.5 | yes |
| Invalid new note or attachment name | see §7 | yes |
| Edit line empty | `Empty — use Archive to remove the line` | yes |
| Outline bullet with no `[[`, `#tag`, `http`, task checkbox or embed (Alt-Edit: the edited line, with its marker) | `Plain bullets aren't indexed — they won't appear in results` | no |
| `[[X]]` with no file and an empty buffer (except the parent `P`; never for a link-only bullet, which is a note patch) | `[[X]] stays a link without a note — click it to add content` | no |
| `[[X]]` with no file and a buffer | `Creates note "X"` | no |
| Link-only bullet `[[X…]]` (Append; `planOutlinePatches` → `describePatch`) | `Creates note "X"` (no file), `Adds alias "A" to X`, `Adds heading "H" to X`, `Sets k: v on X` | no |
| Buffer for an existing note `X` | `Appends to X.md` | no |

**Save:** the steps are listed in §4.2 (Append) and §5 (Edit). They run in order. The editor remembers the steps that finished, so after a failure, Save again runs only the remaining steps and never writes content twice. A failed step shows an Obsidian `Notice` with the message and the files already written, and the editor stays open with all text intact.

**Success:**
1. Close the editor (unless another editor was opened while saving).
2. Reindex every touched markdown file as described in §2.
3. Leave the editor: a Search view returns to its search, which selects, reveals and flashes the written row; Quick Add closes and opens the Search modal with its last query, selecting and flashing the written row.

**Close vs discard:** Escape (after dismissing an open suggestion / leaving the content section), ✕ and the backdrop close the editor and keep the Append draft; an Alt-Edit or prose session is discarded on close (`InlineEditor`'s unmount cancels any `mode !== "append"` session). The footer button **Discard** (Append) / **Cancel** (Alt-Edit, prose) drops the session: it trashes all session attachments with `app.fileManager.trashFile`, discards the buffers and closes the editor. Nothing else was written.

### 3.8 Pasting links

A paste whose plain text, trimmed, is a single URL (`scheme://…` with no whitespace) becomes a markdown link in either section, and in an append chain's search input (§6a) (`linkPasteEdit` in `clipboard.ts`, over `pastedUrl` / `pasteLink` in `textarea-ops.ts`):
- **Selection:** `[selection](url)`, caret after the link. The selection wins over any clipboard title.
- **Rich link, no selection:** when the clipboard HTML has exactly one `<a>` whose `href` is the URL (ignoring one trailing `/`) and whose text is not just the URL, the paste gives `[title](url)` with the title (brackets escaped) selected. This ignores the "Auto convert HTML" setting: no HTML is converted.
- **Otherwise:** `[](url)` with the caret between the brackets.
- **Raw URL:** the URL is pasted as-is right after `](` (e.g. into Mod+K's selected `url`), over a multi-line selection, or over a selected URL. **Mod+Shift+V** always pastes the raw URL.

### 3.9 Mobile toolbar

Soft keyboards have no Tab or Shift+Tab, and Obsidian's own mobile toolbar acts on `workspace.activeEditor`, which the fields never become (§3.1). So on mobile (`Platform.isMobile`) the editor shows its own row of icon buttons (`.ts-editor-toolbar`) between the fields and the preview. Each acts on the content section when it is open and was focused last, else on the outline. The buttons `preventDefault` on mousedown so the field keeps focus and the keyboard stays up. Desktop shows no toolbar.

| Button | Action |
|---|---|
| Insert link | Wrap the selection in `[[…]]` (empty: `[[]]`), caret before `]]`, so the link results (§3.4) open on the text inside |
| Task | The caret line becomes a `- [ ] ` task (`toggleTask`: bulleted first if needed, `[ ] ` after the marker); on a line that already has a checkbox (`[ ]` or `[x]`) the checkbox is removed. Outline (Append) and content. Disabled in an Alt-Edit outline |
| Indent / Outdent | Outline (Append): Tab / Shift+Tab (§3.6). Content: Obsidian's `indentMore` / `indentLess` (`MarkdownFieldHandle.indent`). Disabled in an Alt-Edit outline (one line, no prefix) |
| Paste | Read the clipboard (`navigator.clipboard.read`, falling back to `readText`) and handle it like a paste into the field (`pasteInto`): files become attachments (§3.5), a URL a link (§3.8), outline text is re-shaped (§3.2), content text is inserted at the caret. An unreadable clipboard shows the Notice `Can't read the clipboard: <reason>`; an empty one `The clipboard is empty` |
| Attach file | Open the device file picker (any type, several files); the picked files are attached like a paste (§3.5) |

## 4. Append

### 4.1 Entry point: the ⊕ dot

**Visual** (matches the reference screenshots):
- An 8 px hollow circle (`border: 1.5px solid var(--interactive-accent)`, transparent fill), centered horizontally on the results list and vertically on the bottom edge of the group's last row.
- On hover it grows to 16 px and shows a `+` (lucide `CirclePlus`, accent color).
- It is rendered as an absolutely positioned element inside the group's last row's `.tree-node` (which is already `position: relative`), so it takes no layout space.
- CSS classes: `.ts-append-dot`, and `.ts-append-dot.is-hover` while hovered.

**When it shows (Tree mode):**
- Only for **page** rows (`node.nodeType === "page"`), whether or not the page has a file.
- The dot sits under the last **visible** row of that page's group. If the page has no visible children, it sits under the page row itself.
- It is visible only while the pointer is over a row of that group, and only for the **innermost** hovered page group, so nested groups never stack dots.
- If pagination (`hasMore`) cuts the group, the dot goes under the last rendered row.

**When it shows (Timeline mode):** under the hovered row. The target page is chosen in this order:
1. the row itself, if it is a page node;
2. else the last page node in `timeline.breadcrumb`;
3. else the note at `node.location.path` (basename).

**Keyboard:** Alt+A on the selected row opens Append for the same target that the dot would use for that row.

**Picking a parent with a draft:** choosing a parent `P` (⊕ or Alt+A) sends `{kind: "link", name: P}`. A draft that already appends to `P` (its `parentName` equals `P`, case-insensitive) is kept unchanged. Any other draft, including a blank one, is replaced by a new draft `- [[P]]\n    - `; its pasted attachments are trashed, as with Discard (§3.7). Without a draft, the draft starts as `- [[P]]\n    - `.

**Blank editor:** **Open editor** (⌥N) in the action panel's View section and Alt+N in the Search pane or Search modal show the draft in that view; the `tree-search:open-editor` and `tree-search:quick-add-modal` commands show it in Quick Add. Both send `{kind: "draft"}`: the draft, or a new one with outline `- ` and no parent. Its root bullets go to today's daily note as root bullets.

**Insert After:** in views with editor mode, the `Insert After` action (Ctrl+I or Alt+I) opens Append for the selected row, exactly like Alt+A, instead of inserting a line in the Obsidian note. The action panel lists it only in views without editor mode, where **Append to [[P]]** doesn't exist. Views without editor mode, and Raycast, keep the Obsidian insert.

All search-view shortcuts, including the editor ones (Alt+A, Alt+Enter, Alt+N, Alt+I) and ⌘K / Ctrl+K for the action panel, are defined once in `src/view/search/shortcuts.ts`. `KeyComboWrapper` and the action panel both run them through `useShortcutHandlers` (`src/view/search/shortcut-handlers.ts`), and the Shortcuts section of the Search modal's help panel lists them. Alt shortcuts are matched by `event.code`. On macOS, Option+N and Option+I are dead keys: their `˜`/`ˆ` composition ignores keydown `preventDefault` and arrives after the editor has taken focus. So every handled Alt shortcut calls `swallowDeadKey` (`src/view/editor/dead-key.ts`), which ends that composition and restores the field it landed in: an `<input>`/`<textarea>`, or one of the editor's CodeMirror fields (its doc and selection are reset in one CodeMirror transaction). Inside the editor's fields Option+N/Option+I are left alone, so `ñ`/`î` can still be typed.

### 4.2 What gets written

In the rules below, the **parent** `P` is a root bullet of the outline that is exactly `[[P]]` (the prefilled line). **Today's daily note** is `normalizePath(`${folder ? folder + "/" : ""}${moment().format(format)}.md`)` from `getDailyNoteConfig()`.

If today's daily note does not exist, create it:
- With `template` set: read that template file (`template + ".md"`, resolved with `metadataCache.getFirstLinkpathDest(template, "")`), replace `{{date}}` and `{{title}}` with the formatted date, and `{{time}}` with `moment().format("HH:mm")`.
- Otherwise: create it with empty content.
- If the template file is missing, use empty content.

Save runs these steps in order:

1. **Attachments:** `resolveAttachmentEmbeds` renames or trashes the session attachments and rewrites the embeds in the buffers (§3.5).
2. **Note contents:** for each non-empty content buffer `X`, in the order the buffers were first opened:
   - If `X` has no file (`metadataCache.getFirstLinkpathDest(X, "") == null`), create `X.md` in `app.fileManager.getNewFileParent(<today's daily note path>)`. The body is the buffer with a trailing `\n`. If a file already exists at the computed path because of a race, abort with the Notice `Note "X" already exists`.
   - Otherwise, append to `X`'s file with `vault.process` and `appendContent`: one blank line (if the file doesn't already end with one), then the buffer verbatim, ending with `\n`. Headings in the buffer are indexed wherever they land, so a `## Decisions` buffer for `P` shows up as a child of `P`.
3. **Note patches** (`patch:<name>` steps, `planOutlinePatches` in `packages/core/src/edit/note-patches.ts`, applied by `applyNotePatch`): every bullet whose text is only a wikilink, optionally followed by `(key:: value)` fields (`parseLinkBullet`; `meta-` fields, block refs and invalid names keep the line verbatim), patches the linked note, merged per note name (case-insensitive):
   - the note is created when missing (`noteFileFor`; today's daily note through `getOrCreateDailyNote`);
   - `[[X|A]]` adds `A` to `aliases`, as does `(aliases:: A)`;
   - `[[X#H]]` appends `## H` at the end of the note unless a heading with that text exists (`ensureHeading`);
   - every other `(key:: value)` is added to the frontmatter key without overwriting (`addFrontmatterValue`: a different scalar becomes a list). `(parent:: [[Y]])` therefore sets the parent relation, the same graph as nesting `- [[X]]` under `- [[Y]]`.

   The fields are stripped from the written bullet; the alias and heading stay in its link. A childless root link bullet that carries an alias, heading or field is a **pure patch**: only the patch is applied and nothing is written to the daily note (not under a line, where every line is written).
4. **Outline:** write the outline into today's daily note (placement below), keeping relative indents. Links to notes created in step 2 are already in the text, so those notes appear under `P`.

**Placement in the daily note** (pure function `appendOutline`, one root bullet and its subtree at a time):
1. A root that is exactly one wikilink `[[P]]` / `[[P|alias]]`: look for the first list line **inside the leading outline** whose content, after the marker, is exactly one wikilink to `P` (case-insensitive on `P`, no other text).
2. **If found:** insert the root's children right after that bullet's subtree (its last line with deeper indent; blank lines inside the subtree count as part of it; trailing blank lines don't), re-indented so they sit at the found bullet's indent + 4 (`appendUnderLinkBullet`).
3. **Otherwise** (any other root, or no such bullet): insert the root and its subtree as typed at the **outline end**:
   - Normally that is the line after the last line of the leading outline (a list line or its indented continuation).
   - If the note has no outline bullets but does have an outline-breaking line, insert right before that line (after any leading blank lines, headings and comments).
   - If the note has neither, insert at the end of the file.
   - The neutral-line rules must match `scanMarkdown` exactly. Reuse its regexes: export `LIST_ITEM_RE`, `LIST_MARKER_RE` and `HEADER_RE` and extract the comment-open logic from `list-scanner.ts` into an exported helper; don't copy them.
4. Indentation is 4 spaces per level (the same convention as `renderPullLine`, `packages/core/src/search/pull.ts:157`), or one tab per level in notes whose list lines are tab-indented. The line ending (`\n` or `\r\n`) is preserved (reuse `splitLines` from `packages/core/src/search/organise-sections.ts`; export it).
5. Frontmatter is never touched. Positions start after the frontmatter block (reuse `frontmatterEnd` from `organise-sections.ts`; export it).

### 4.3 Examples

Parent `Project X`, today is `2026-09-30.md`:

```markdown
- [[Standup]]
    - [[Alice]]
Notes from the day…
```

Outline `- [[Project X]]\n    - [[Related note]] https://example.com/spec` (the prefill plus one child) gives:

```markdown
- [[Standup]]
    - [[Alice]]
- [[Project X]]
    - [[Related note]] https://example.com/spec
Notes from the day…
```

A second append has this outline (no file `New child.md` exists; a screenshot was pasted under `New child` and aliased):

```markdown
- [[Project X]]
    - [[New child]] kickoff
        - ![[new-child-image-1.png|Whiteboard]]
```

The user clicked `[[New child]]` and typed `Kickoff with **Bob**.` in its content section. The save does the following:
1. Renames `new-child-image-1.png` to `whiteboard.png`.
2. Creates `New child.md` containing `Kickoff with **Bob**.\n`.
3. Writes the outline:

```markdown
- [[Standup]]
    - [[Alice]]
- [[Project X]]
    - [[Related note]] https://example.com/spec
    - [[New child]] kickoff
        - ![[whiteboard.png|Whiteboard]]
Notes from the day…
```

An append whose outline is `- #decision ship Friday` and whose `[[Project X]]` content buffer is `## Decisions` appends `\n## Decisions\n` to `Project X.md` and adds `- #decision ship Friday` under `- [[Project X]]` in the daily note.

## 5. Edit

**Hint:**
- Holding **Alt/Option** shows a small pencil (lucide `Pencil`, 12 px, `opacity: .6`) at the right end of the hovered row, or of the selected row when the pointer is outside the list.
- Alt state comes from `keydown`/`keyup` listeners on `window` (and from `altKey` on `mousemove`). The listeners are registered while a view with `allowEditing` is mounted and reset on `blur`.
- The pencil appears only on editable rows (below).
- CSS class: `.ts-edit-hint`.

**Open:**
- Alt+click on the row, or Alt+Enter on the selected row. `KeyComboWrapper` must check `event.key === "Enter" && event.altKey` before its plain-Enter branch.
- Alt+click must not also select or open the row: call `preventDefault()`. `handleTreeNodeClick` already returns early when the event is `defaultPrevented`.
- **Edit line** in the action panel's Edit section, shown only for editable rows (titled **Rename** on header and attachment rows). This is the mobile entry point; on mobile a long-press opens the panel, not the editor.

**Titles:** the editor's title (`editorTitle`) is `Edit <file>:<line>` for a line, `Rename <note>#<heading>` for a heading and `Rename <file name>` for an attachment. The Search modal's own title follows the view (`searchModalTitle`, `SearchViewMolecule.searchModalTitleAtom`): an Alt-Edit session shown in it takes the editor's title, which the editor then doesn't repeat; an append chain (§6a) is `Patch <last row chip>`; anything else `Search`.

**Editable rows:**
- text rows;
- header rows (Rename);
- **child** page rows, i.e. Tree indent > 0, or Timeline page rows whose `location.path` is not the page's own file. Their location is the bullet that wrote the relation, e.g. `- [[Page]]` in a daily note;
- attachment rows whose file exists (Rename, below).

Not editable: root page rows (their location is line 0 of the page's own file), folder and month rows, and the Archive row.

**Rename an attachment** (`editKind: "file"`): the outline holds the file name without its extension; no file pastes, preview, Alt+Enter or mobile toolbar. Hints (`renameFileHints`) block an empty name, invalid characters and a name another file already has (a case-only change is allowed). Save renames the file in its folder (`renameVaultFile`, Obsidian's `fileManager.renameFile`, which updates the links to it), rebuilds the index (there is no rename handler) and selects the renamed row.

**Flow:**
1. On open, read the file at `location.path` and take line `location.position.start.line`.
2. The line must be a list item (`LIST_ITEM_RE`) or a heading (`HEADER_RE`).
3. It must contain the node's identity:
   - text: every `pageTarget` of the node's `obsidian_link` tokens;
   - page: `[[<page>`;
   - header: the header text.
4. If any check fails, show the Notice `This row's index is out of date — try again in a moment`, call `refreshPage` on that file, and don't open the editor.
5. **The outline section shows the editable part only:**
   - List item: the text after the marker and after a task checkbox (`[ ] `, `[x] `). The indent, marker and checkbox are preserved.
   - Heading: the text after `#… `. The level is preserved.
6. Link autocomplete, pasting attachments and the content section work as in Append (§3.3–§3.5). The edited line stays a single line.
7. **Save** (Enter, Mod+Enter or Shift+Enter), in order:
   1. Attachments (§3.5), which may rewrite embeds in the line.
   2. Note contents, as in step 2 of §4.2.
   3. The line: write with `replaceLineText(content, line, expectedLine, newText)` inside `vault.process`. If the line at `line` is no longer byte-identical to the line read on open, throw. The Notice says `Line changed since editing started — reopen the editor`.
   4. Then `refreshPage` every touched file.

## 6. Drag / reparent (Tree mode only)

**Draggable rows:**
- Tree rows with indent > 0 get `draggable={true}`, except:
  - header rows;
  - the Archive row;
  - **inline-link rows**: a text row whose own tokens link to its current tree parent (e.g. `- met [[Old parent]] about X`). Its parent comes from the link in its own text, so moving the line would not change it. The drag is refused with the `title` tooltip `Linked inline — edit the text to change its parent`.
- **The current parent** is the nearest preceding row with a smaller indent.

**Drop targets:**
- **page** rows only.
- Not allowed:
  - the dragged row itself;
  - its current parent (no-op);
  - any row inside the dragged row's group (that would create a cycle).
- While dragging over a valid target, that row gets `.ts-drop-target` (accent outline). Invalid targets show `dropEffect = "none"`.

**Move under…** (action panel, Tree mode, every platform): shown for rows that are draggable by the rules above. It lists every row that is a valid drop target for the selected row (`isValidDropTarget`), in result order, and choosing one calls `reparentAtom(selectedPos, targetPos)`. That is the same rule and write path as a drop, so the choice is limited to pages visible in the current results.

**Writes**, by where the relation was written. Let `F = location.path` of the dragged row, `C` = the dragged node, `Old` = the current parent, `New` = the drop target page.

1. **Frontmatter relation** (C is a page, and the edge location is `C`'s own file, line 0; same test as `isFrontmatterRelation` in `pull.ts:112`):
   - Use `fileManager.processFrontMatter` on `C`'s file.
   - In `fm[parentRelation]` (a string, or an array of strings), replace the entry that links to `Old` with `"[[New]]"`. Nothing else changes.
2. **Bullet in Old's own note** (`F` is the file of `Old`, or of the page that owns `Old` when `Old` is a header):
   - Cut `C`'s bullet subtree from `F`. The subtree is the bullet line plus all following lines with deeper indent, including unindexed prose sub-bullets and inner blank lines.
   - Paste it at the outline end of `New`'s note (the placement rules from §4.2, with no wrapper bullet), re-indented so its head is at indent 0 and relative indents are kept.
   - If `New` is a reference page, create `New.md` in `fileManager.getNewFileParent(F)`.
3. **Bullet anywhere else** (typically a daily note):
   - **Re-nest in `F`.** Cut `C`'s subtree and paste it under the first leading-outline `[[New]]` bullet in `F`, as that bullet's last children, re-indented to its indent + 4.
   - If there is no such bullet, first add `- [[New]]` at `F`'s outline end.
   - This keeps the original date, because `F` stays the file that records the relation.
   - The old `- [[Old]]` bullet stays in place even if it is now childless: it still records that `Old` was mentioned that day.

**Example (rule 3).** Given `2026-09-12.md`:

```markdown
- [[Old parent]]
    - [[Child]]
        - detail line
```

Dropping `Child` on `New parent` gives:

```markdown
- [[Old parent]]
- [[New parent]]
    - [[Child]]
        - detail line
```

**Guards:**
- Before cutting, check the head line as Edit does (list item containing `C`'s identity). Otherwise show the Notice and reindex, as in §5.
- Compute the subtree from the fresh content inside `vault.process`, never from graph line numbers alone.
- A move inside one file (rule 3) is one `vault.process` call.
- A cross-file move (rule 2) first appends to the destination, then cuts from the source. If the cut guard fails, the Notice says `Copied to [[New]] but the original line changed — remove it manually`, so no content is lost.
- Afterwards, `refreshPage` every touched file.

## 6a. `>` (append from Search) and reparent (`<`)

Search modal and Search pane only (`allowEditing`). `>` builds an **append chain** in the search input: chips that Enter writes through the editor's own append Save, or that Alt+Enter opens in the editor. The chain is Outline-editor text; both paths share the patch interpreter of §4.2.

- **Anchor chip** (`EditorMolecule.pushChainAtom`, the pure choice is `appendPickFor` in `src/view/editor/append-target.ts`): `>` on the selected row (archive rows excluded) pushes a row chip: today's daily note page → Today, another page → the note, a header → `P#H`, a line → the line (checked as Alt-Edit does: `readLine` + `isRowLine`, else the out-of-date Notice), any other row → the Notice `Can't add under this row`. With no chain and no selected row, a query that is exactly one closed `[[name]]` anchors at that note (it may not exist yet) and a blank query at Today. While the chain has only row chips, the input searches under the anchor (`chainResults`: `advancedSearch` from its key), and `>` on a result drills into it.
- **Entry chips:** once the chain has entries, or when the input is one (`isEntryInput`: `|`, `#`, `(`, `[ ] `, `- `, `[[`, `key::`, a markdown link `[…](`), `>` pushes the typed text (`parseChainEntry`): `[[N]]` / `[[N#H]]` / `[[N|A]]` (a note), `#H` (a heading), `|A` (an alias), `(k:: v)` / `k:: v` (a field), else an item (`- `, `[ ] `, `[x] ` markers). An open `[[frag` lists link targets; Enter/Tab completes it. Inside a chain a `#tag` is a heading entry, not a filter. Nothing is written until Enter.
- **What a chain writes** (`chainOutline`): a note anchor starts with `- [[P]]` (the editor's `parentName`), a header with `- [[P#H]]`, a line writes under it (`underLine`), Today into the daily note. Notes and items nest; a heading re-points the anchor's own `[[P]]` root (`Note > #h > [ ] t` → `- [[Note#h]]` / `    - [ ] t`) or adds a `[[N#H]]` link line under the current note; an alias or field patches the current note's link line (Today: a `[[<daily>]]` patch root). Aliases, fields and headings need a current note, else an error shows in the preview. `Note > [[New Node]] > |new-alias > #header > [ ] task` writes `- [[Note]]` › `- [[New Node|new-alias]]` › `- [[New Node#header]]` › `- [ ] task` and creates New Node with the alias and heading.
- **Enter** (`commitChainAtom`) writes the pending chain (`chainWriteAtom`: the chain plus the typed input) through `runAppendSteps`, keeps the row chips, clears the input and selects the written row. Plain text that matches rows under the anchor stays a search and Enter opens the selected row; prefix `- ` to add it. A failure keeps the chain for a retry (patches are idempotent). `ChainPreview` shows the destination, the rendered lines and the patch hints.
- **Pastes:** a single URL becomes a markdown link in the input as in the editor (§3.8: over the selection, `[title](url)` with the title selected, or `[](url)` with the caret inside), so it is an item entry. Alt+Enter (claimed through the search input's Obsidian Scope, since Obsidian's hotkeys take it first) and list or file pastes (`pasteIntoChainAtom`) open the Outline editor on the chain (`openChainEditorAtom`, `{kind: "outline"}` request), applying the paste once it mounts (`pendingPasteAtom`). Other multi-line pastes open the prose editor on the anchor: the note's whole text with the paste appended, or under a line a new note named from the paste's first line (`proseNameFrom`).
- **Under a line** (`EditorState.underLine: {path, line, expectedLine, label}`): Save renders the outline (`renderOutline`), stamps every line (`stampAppendedLine`: `[scheduled:: today]` for an open task, else `[created:: today]`) and writes it as the line's last children in its own file (`appendUnderLine`); a changed line throws `StaleLineError`, shown as `"<label>" changed since you picked it — pick the line again`, keeping the draft. Because every line is dated, the "Plain bullets aren't indexed" hint is off (`editorHints`' `datedLines`). With no caret note, the link list shows the line's note (`outline:"<path>" :page`) and pasted attachments are named after that note.
- **Prose** (Alt+Enter on an outline line without a link, `openProseAtom(ProseRequest)`) opens a `mode: "prose"` session over the draft: for a draft with a parent, that page's whole note (a heading parent uses its page); with none, today's daily note; for an `underLine` draft, a new note (name field empty, so Save is blocked until it is named) whose Save appends ` [[Name]]` to the line. Save replaces the file (`writeWholeNote`), and a change to the outline or frontmatter needs a second Save.
- **Move to** (`<`, Alt+M, or **Move to…** in the action panel) starts a reparent of the selected row (`chainAtom` in `reparent` mode, `src/view/search/chain.ts`). A page gets pages and folders as candidates. A line gets pages, headers and lines. A folder, an attachment or a folder note (its folder) gets folders only. Headers and other rows can't be moved. Enter moves it (`planReparent` → `reparent`: `set-parent`, `to-folder`, `to-daily`, `under-line`). A `to-folder` move rebuilds the index, because the index has no rename handler. For a page or line with no matching rows, pressing Enter twice moves it under a new `[[typed name]]`. Move to… replaces the folder-picker Move To in every view. Alt+M and the panel item work in every view with a search box; typing `<` needs editor mode and no append chain.
- Backspace in an empty input drops the last chip and restores the text typed before it (an entry's text, or the query before the chain). Escape (claimed through an Obsidian Scope while the search input has focus, so the modal stays open) leaves the chain and restores the query typed before it.

## 7. Write safety (applies to all three features)

- Every text rewrite goes through `app.vault.process(file, fn)` (atomic read-modify-write). `fn` re-validates its expected line and throws on mismatch.
- Raise `minAppVersion` in `manifest.json` from `0.15.0` to `1.6.6`, the version of the pinned `obsidian` typings that declare `vault.process`, `vault.createBinary`, `fileManager.getAvailablePathForAttachment`, `renameFile` and `trashFile`. The existing `processFrontMatter` use already needs 1.x.
- Note creation uses `app.vault.create(path, content)`. The folder comes from `app.fileManager.getNewFileParent(sourcePath)` (Obsidian's "Default location for new notes"). Note filenames are the typed name.
- New note names and attachment names can't contain `\ / : * ? " < > |`. Such a name blocks Save with the hint `Names can't contain \ / : * ? " < > |`.
- Links are written as `[[Name]]` wikilinks and attachments as `![[name.ext]]` embeds, whatever the user's link-format setting. This matches the existing writers (`reverseMarkdownParsing`, `renderPullLine`).
- **Only attachments are written before save.** Pasted files go to disk at paste time (§3.5), are renamed or trashed on save, and are trashed on cancel. Every other write happens only after the user saves or drops. Failed guards leave notes untouched.

## 8. Code layout

**Pure core** (`packages/core/src/edit/outline-edit.ts`, exported from `packages/core/src/index.ts`, no I/O; content in, content out; line endings preserved):

```ts
export type OutlineLine = { depth: number; marker: string; text: string } // marker: "- ", "- [ ] ", "- [x] "
export type OutlineIssue =
  | { kind: "empty" } | { kind: "heading"; line: number } | { kind: "plain"; line: number }
export function parseOutline(input: string): { lines: OutlineLine[]; issues: OutlineIssue[] } // drops empty bullets, normalizes tabs and unmarked lines
export function renderOutline(lines: OutlineLine[], baseDepth: number): string[]
export function findOutlineEnd(content: string): number          // line index to insert new root bullets
export function findSubtreeEnd(lines: string[], headLine: number): number // exclusive end of a bullet's subtree
export function findLinkBullet(content: string, pageName: string): number | null
export function linkOnlyTarget(text: string): string | null     // page of a lone `[[X]]` / `[[X|alias]]`
export function appendUnderLinkBullet(content: string, pageName: string, outline: OutlineLine[]): string
export function appendOutline(content: string, outline: OutlineLine[]): string // editor outline → note (§4.2)
export function appendContent(content: string, text: string): string
export function replaceLineText(content: string, line: number, expectedLine: string, newText: string): string // throws on mismatch
export function cutSubtree(content: string, headLine: number, expectedHead: string): { content: string; block: string[] } // block re-indented to head indent 0
export function pasteUnderLinkBullet(content: string, pageName: string, block: string[]): string
export function pasteAtOutlineEnd(content: string, block: string[]): string
```

`packages/core/src/edit/attachments.ts`:

```ts
export type AttachmentKind = "image" | "audio" | "video" | "file"
export function slugify(name: string): string
export function attachmentKind(mime: string): AttachmentKind
export function attachmentExt(fileName: string, mime: string): string
export function attachmentName(base: string, kind: AttachmentKind, ext: string, taken: (name: string) => boolean): string // smallest free N
export type SessionAttachment = { name: string; ext: string }
export type AttachmentPlan = {
  renames: { from: string; to: string }[]
  trash: string[]
  buffers: Record<string, string>          // input buffers with embeds rewritten
  error?: { ambiguous: string }
}
export function resolveAttachmentEmbeds(buffers: Record<string, string>, session: SessionAttachment[], exists: (name: string) => boolean): AttachmentPlan
```

`packages/core/src/search/search.ts`: `linkTargetTree(graph, query, separator): ResultNode[]` (§3.4), used by both `SearchModalMolecule` and the editor.

**Obsidian appliers** in `src/editing/vault-edits.ts`: `pasteAttachment`, `applyAttachmentPlan`, `trashSessionAttachments`, `writeNoteContents`, `appendToDailyNote`, `applyNotePatch` (with `addFrontmatterValue`), `editLine`, `reparent`, `getOrCreateDailyNote`. They are the only callers of `vault.process`/`create`/`createBinary`/`processFrontMatter`/`renameFile`/`trashFile` for editor mode, and they return the list of touched markdown `TFile`s so the UI can reindex them.

**UI:**
- `src/view/editor/QuickAddView.tsx` (Quick Add's body: the editor), `src/view/editor/InlineEditor.tsx` (title, both sections, preview, footer, and `LinkResults` below), `src/view/editor/MarkdownField.tsx` (the field: Obsidian's markdown editor plus the owner's capture hooks), `src/view/editor/obsidian-editor.ts` (the private-API access to Obsidian's editor class), `src/view/editor/LinkSuggest.tsx` (`useLinkSuggest`, `LinkResults`), `src/view/editor/MarkdownLine.tsx` (moved), `src/view/editor/editor.css`, `src/view/editor/textarea-ops.ts` (pure text edits: `appendPrefill`, `outlineBackspace`, `ensureBullet`, `insertLinkAtCaret`, `pasteOutline`, …), `src/view/editor/draft.ts` (`DEFAULT_DAILY`, `nextSessionId`, `basenameOf`, `dailyConfigOf`, `emptySession`, `newAppendState`, `newUnderLineState`, `PersistedDraft`, `draftToData`, `draftFromData`, `editorTitle`), `src/view/editor/append-target.ts` (`appendPickFor`, `closedLinkName`).
- Editor state atoms live in `EditorMolecule`, scoped like `SearchViewMolecule`. The editor state is `{ sessionId; mode: "append" | "edit" | "prose"; sourcePath; parentName?: string; underLine?: UnderLine; originalLine?: string; outline: string; caret: number; contents: Record<string, string>; contentOrder; activeContent: string | null; attachments: SessionAttachment[]; doneSteps: string[]; touchedPaths; saving; prose?: ProseTarget; proseConfirmed? } | null`. `editorStateAtom` is derived from `GlobalAtoms.editSessionAtom` ?? `appendDraftAtom`. `isSaveBlocked` combines blocking hints and `appendOutlineEmpty`. `applyEditorRequestAtom` (`quick-add-flow.ts`) applies an `EditorRequest`; `showEditorAtom` / `closeEditorAtom` show and close the editor in the view's host; `GlobalAtoms.pendingSelectAtom` carries the row a Search view selects on its next recompute.
- The ⊕ and drag wiring live in `SearchTreeNode.tsx`, `SearchTimeline.tsx` and `SearchViewFlatten.tsx`, gated on `allowEditing`. Row gestures (Alt+click edit on desktop, long-press opening the action panel on mobile) live in `useRowGestures` (`src/view/search/row-gestures.ts`). The action footer and panel are `ActionFooter.tsx` / `ActionPanel.tsx`, with the pure item builder `panelItems` in `src/view/search/action-panel.ts`, which uses `appendTargetAt`, `isEditableRow`, `dragInfo` and `isValidDropTarget` for its Edit section.

## 9. Testing

- **Core unit tests:** `packages/core/src/__tests__/outline-edit.test.ts` and `attachments.test.ts`, content in, content out, for every function in §8. Cover:
  - frontmatter;
  - CRLF;
  - a note that starts with prose (placement before the prose);
  - an existing `[[P|alias]]` bullet;
  - subtrees with inner blank lines and unindexed prose children;
  - guard mismatches throwing;
  - `parseOutline` issues (empty outline, heading line, plain bullet);
  - `attachmentName` skipping taken names;
  - `resolveAttachmentEmbeds`: alias rename, a typo'd target matched by extension, an ambiguous match, collision suffixes, unreferenced attachments trashed.
- **`linkTargetTree`:** returns only page/header nodes nested as in Insert Link, hides archived rows, and returns nothing below 3 characters. The existing Quick Link tests keep passing.
- **Round trip:** after `appendUnderLinkBullet`, parse with `parseVaultFile` + `indexSinglePage` and assert that the new lines are children of `P` (proves they landed inside the leading outline).
- **Applier tests:** `src/__tests__/vault-edits.test.ts` with the Map-backed fake vault pattern from `src/__tests__/apply-organise-plan.test.ts` (extend it with `process`, `createBinary`, and `fileManager.getNewFileParent`/`getAvailablePathForAttachment`/`renameFile`/`trashFile`/`processFrontMatter`). Any new `obsidian` value import (`Platform`, `Scope`, `moment`) must be added to `test-support/obsidian-mock.ts`.
- **Quick Add text ops and draft:** `src/__tests__/row-editing.test.ts` covers `ensureBullet`; `src/__tests__/quick-add-draft.test.ts` covers the `data.json` round trip of `quickAddDraft` (and its absence with no draft); `src/__tests__/quick-add-flow.test.ts` covers Append keeping or replacing the draft.
- **Live check** per AGENTS.md "Live Obsidian Testing" on a dev vault:
  - type `[[` plus a query and check that the results below the editor list pages and headers like Insert Link;
  - append an outline with a new note that has content, plus a pasted image renamed by alias (check the file name on disk and the embed);
  - Discard an Append draft (or Cancel an Alt-Edit) after pasting and check that the file was trashed;
  - Alt-edit a row;
  - drag a daily-note child to a new parent;
  - confirm the rows update without a manual refresh and that `await tab.errors()` is empty.
