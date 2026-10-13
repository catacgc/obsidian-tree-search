# Changelog

## Unreleased

- **No default selection:** in the Search modal and pane, results no longer select their first row; press <kbd>↓</kbd> or click a row. <kbd>Enter</kbd> with nothing selected still acts on the first row (the footer names it). <kbd>&gt;</kbd>, <kbd>&lt;</kbd>, <kbd>Alt</kbd> keys and the action panel need a selected row; <kbd>↑</kbd> on the first row clears the selection. Quick Link and `[[` link completion still select the first row.
- **Patch from a search:** <kbd>&gt;</kbd> with nothing selected patches today's daily note and pre-fills the box with an item matching the search: `is:task #home` (or a saved filter such as `:Tasks`) gives `- [ ] #home `, ready to finish and add with <kbd>Enter</kbd>.
- **Fix:** the date chips (All, 7d, 30d, 1y) and filter pills show their tooltip on hover (`in:7d`, `:Tasks — is:task`).
- **Rename Filter:** while a filter pill is active, the action panel's **Filter** section offers **Rename Filter** for it (for example **Rename Filter "Tasks"**). The pill keeps its query and place, and every `:Name` reference to it, in other pills and in the search box, follows the new name.
- The action panel's **Move to…** is now **Move under…**, matching the footer and <kbd>&lt;</kbd>. The separate Tree-only **Move under…** list of notes in the results is gone: the search finds every note, on every platform.
- **Cut drawer:** in the Search modal and pane, <kbd>⌘</kbd>+<kbd>X</kbd> (<kbd>Ctrl</kbd>+<kbd>X</kbd>) cuts the selected row into a drawer above the footer; press it again to take the row out. The drawer, shared by the modal and the pane, moves every cut row under a new parent at once (**Move under…**), archives them (**Archive**) or empties (**Clear**). The action panel has the same actions.
- **Unschedule:** the action panel's Task section has **Unschedule** for an open task with a scheduled date, its own or one of its open subtasks'. It removes the dates (`[scheduled:: …]`, `(scheduled:: …)` or `⏳ …`) from the task and from the open tasks nested under it.
- **Task dates:** a task row shows a date only when the task has a scheduled or due date, its own or an open subtask's. Unscheduled tasks no longer show their creation date or their note's date.
- **Tree context:** a top-level line or heading in the Tree now shows its place in its note (the enclosing heading, parent line or note) below it, as the Timeline does.
- **Fix:** in a note that mixes tab and space indentation, a bullet now nests under the bullet it appears under in Obsidian (a tab counts as 4 spaces). The parse cache is rebuilt once after updating.

## 0.15.0

The first release since 0.11.0. Full documentation, with screenshots, is at https://catacgc.github.io/obsidian-tree-search/.

### Breaking changes

- **Obsidian 1.6.6 or later** is required.
- **Only a note's leading outline is indexed.** The bullets at the top of a note, before any prose, make up its part of the tree.
- **The built-in `:` shortcuts are gone.** `:page`, `:task`, `:daily` and the rest no longer exist. `:Name` now refers to a saved filter (see below). To bring a shortcut back, save it as a filter: for example, a filter named `page` with query `is:page` makes `:page` work again. `:daily` is now written `outline:":daily"`.
- Saved filter names are single words (letters, digits, `-`, `_`). Names saved with spaces load with `-` in their place.

### Search

- **New query language:**
  - `is:` (type), `has:` (content) and `in:` (recency) operators.
  - `-` negation, which excludes a matching line together with its whole subtree.
  - `|` alternatives and `( )` grouping.
  - Autocomplete for `is:`/`has:` values.
  - When the search box is empty, a clickable syntax cheat sheet.
- **Scopes:**
  - `outline:<note>` limits results to a note's outline.
  - `[[note]]` and `[[note#heading]]` show that note or heading with everything written about it.
  - An open `[[name` completes to a link. `[[not#hea` matches headings by both parts (`Note#Header1`, `Noting#Heading`).
- **Saved filters (pills):**
  - Save any query as a named pill (action panel → Save as Filter) and delete it again.
  - Refer to a filter in a query with `:Name` or `-:Name`.
  - Typing `:` lists your filters, and the pills on offer are highlighted.
- **Timeline:** results as a flat, dated list (<kbd>Alt</kbd>+<kbd>T</kbd>), with emoji items pinned to the top.
- **Recency:** the All / 7d / 30d / 1y chips (<kbd>Alt</kbd>+<kbd>1</kbd>–<kbd>4</kbd>) work in both Tree and Timeline mode.
- **Rows:**
  - Rows show compact relative dates, with labels for future dates.
  - Rows show attachment thumbnails.
  - A match on a nested line shows its whole outline block.
  - A line under an inline parent shows that parent as context.
- **Tasks:**
  - Complete a task from its checkbox.
  - Reschedule with Today, Tomorrow, Weekend or Next Week.
  - Overdue tasks sort first.
  - A task line is dated by its scheduled or due date.
- **Archive:**
  - Archived notes, sections and lines are folded into an "Archive (N)" row.
  - `is:archived` shows them.
- **Previews:** hold <kbd>Cmd/Ctrl</kbd> and hover over a result to preview the place where that line was written.

### Editing

- **Quick Add and the inline editor:**
  - Append (⊕ or <kbd>Alt</kbd>+<kbd>A</kbd>) writes bullets under a note into today's daily note.
  - The editor keeps a persistent draft.
  - Typing `[[` suggests notes from the tree.
  - Pasted URLs become markdown links.
  - Pasted attachments are named after the note.
  - Mobile has a toolbar.
- **Alt-Edit:** edit a line where it was written (<kbd>Alt</kbd>+<kbd>Enter</kbd>), rename a heading, or rename an attachment.
- **Search chains:**
  - `>` patches under the selected row, adding notes, headings, aliases, fields or items.
  - `<` moves rows.
  - Quick Add opens Search in patch mode.
- **Dates:**
  - New and moved lines are dated (`[scheduled::]` for tasks, `[created::]` otherwise).
  - On a task line, `@` offers Today, Tomorrow, Weekend or Later.
- **Action panel** (<kbd>Cmd/Ctrl</kbd>+<kbd>K</kbd>):
  - Line, note, task, filter and view actions.
  - Patch, Rename (notes and embedded files) and Delete with confirmation.
- **Drag to reparent:** in Tree mode, drag a row onto a note row to move it under that note.
- **Consolidate notes:** a pane that moves the lines written about a topic elsewhere into its note.

### Panes and integrations

- The File context pane shows the active note's parents, its children and related tasks.
- The Raycast API adds a timeline view with a recency window, and Archive/Unarchive actions.
- The mdtree CLI (`index`, `watch`, `serve`, `query`) indexes and searches vaults without Obsidian.
- The plugin keeps its parse cache across restarts, so startup is faster.
