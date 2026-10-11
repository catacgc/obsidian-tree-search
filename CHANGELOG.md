# Changelog

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
  - An open `[[name` completes to a link.
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
