# Changelog

## Unreleased

- **Enter with nothing selected is Add to:** in the Search modal and pane, and in the outline editor with an empty input, <kbd>Enter</kbd> with no row selected adds a line (the footer reads `Add to …`): to Today with no search, else under the note the search scopes to. The new line is pre-filled from the filters, as `>` used to do: `[[new page]] . is:task home` adds `- [ ] home ` under **new page**, `is:task #home` with no note scope writes `- [ ] #home ` to Today, and filter crumbs in the outline add theirs. <kbd>Alt</kbd>+<kbd>A</kbd> pre-fills the same way.
- **Add to focuses the new line:** the new line's field takes focus and the view scrolls down to it, also while the results are still loading.
- **Add to absorbs Quick Add:** with no row selected and no search typed, <kbd>Alt</kbd>+<kbd>A</kbd> (or **Add to Today** in the action panel) opens today's note as the outline with a new line open, as Quick Add did. The <kbd>Alt</kbd>+<kbd>N</kbd> shortcut and the panel's **Quick Add** item are gone; the **Quick Add** and **Open editor** commands stay.
- **Fix:** the `[[` link suggestions in the outline's line editor could stay off after the editor opened, because the editor's focus was lost and not regained when its field was rebuilt.
- **Breaking:** <kbd>Alt</kbd>+<kbd>A</kbd> is now **Add to** (a new line at the end of the view), and the **Append to [[Note]]** editor is gone: its shortcut, action panel item and persisted draft (`quickAddDraft` in `data.json`, now ignored). <kbd>Alt</kbd>+<kbd>I</kbd> / **Insert After** in a view with editor mode inserts a line in the Obsidian note again, as in views without editor mode.
- **Explore mode:** in the Search modal and pane, <kbd>Enter</kbd> on a note or heading, or on a line with lines under it, now opens the outline in explore mode (titled **Explore …**), and inside it explores further, adding the row to the breadcrumb. On a line with nothing under it <kbd>Enter</kbd> does what fits the line instead of exploring it (the footer names it): a web link opens, a task is completed (or reopened), the line's first `` `snippet` `` is copied, and any other line is edited in place. Opening a link or copying a snippet closes the modal (unless you have unsaved edits). Clicking a selected row again explores it, whatever it is; a click on a snippet copies just the snippet, and a task is completed only from its checkbox. Note links and the action panel's Open items also explore; ⊕, <kbd>&gt;</kbd> and Quick Add open edit mode. The content pane starts collapsed for a note with no text besides its outline, and in explore mode shows **Save** and a new **Discard** only while focused.
- **Add to everywhere:** the **Add to …** row now ends the plain search results too, and the action panel offers it. With a row selected (**Add to <row>…**) it explores that row and opens a new line at its end; with nothing selected (**Add to Today…**) it opens a new line at the end of the results, written to today's daily note. In the outline it replaces **New line…** as **Add to <root>…**.
- **Outline editor:** in the Search modal and pane, <kbd>Alt</kbd>+<kbd>Enter</kbd> (or the action panel's **Edit**) edits the selected row in place: the outline opens on the current results and the row turns into a line editor. With nothing selected (**Edit search**) it opens the outline on the current results. The ⊕ under a hovered row and <kbd>&gt;</kbd> open the row's whole tree as an editable outline; <kbd>&gt;</kbd> with nothing selected opens today's daily note with a line pre-filled from the search (`is:task #home` gives `- [ ] #home `). A breadcrumb (`search › Note › line`) shows where you are; typing filters the outline and <kbd>Enter</kbd> makes the filter a crumb, or, with a row picked, edits that row and keeps the filter typed. <kbd>Enter</kbd> on a line or heading edits it in place: <kbd>Alt</kbd>+<kbd>Enter</kbd> adds a line under it and <kbd>Enter</kbd> saves. Lines you edit stay listed, outlined in red, when they stop matching. An **Add to …** row (click it, or <kbd>↓</kbd> past the last row and <kbd>Enter</kbd>) adds to today's daily note (under a link to a note or heading) or under a line. A content pane above the footer edits the note's text (for a heading, the text under it), takes pasted and dropped files, and can be expanded, collapsed or closed. **Quick Add** (command, <kbd>Alt</kbd>+<kbd>N</kbd>) opens it on today's daily note with a new line. <kbd>Esc</kbd> or the `search` crumb goes back to the search.
- **Fix (mobile):** the outline breadcrumb and the Move under chip now sit on their own row above the search field and wrap, so many crumbs no longer push the view sideways and hide the results. On desktop a long breadcrumb no longer widens the view either.
- **Breaking:** the outline editor replaces patch mode and Alt-Edit. The `>` search chain (row and entry chips such as `Note > [[New Node]] > |alias > #heading`) is gone: <kbd>&gt;</kbd> opens the outline editor, where you type the lines themselves. <kbd>Alt</kbd>+<kbd>Enter</kbd> still edits a line or renames a heading where it is listed, now inside the outline editor on the current results (an attachment still opens Rename). Quick Add no longer searches for a row to add under.
- **One archive tag:** `#archive` (the **Archive tag** setting) archives a line with everything nested under it, a heading with its subheadings and section, or, in the frontmatter `tags`, a whole note. An archived line is hidden by default and shown greyed with `is:archived`; before, a `#archive` line was left out of the index and its children moved up a level, and a `#archive` heading did nothing. A line under an archived line or heading is hidden wherever it shows up, also under the notes it links to. **Archive** / **Unarchive** now add or remove the tag, and also work on heading rows.
- **Breaking:** the `(meta-mdtree:: archive)` marker is no longer read. Run **Convert legacy archive markers to #archive** from the command palette once to rewrite every marker in the vault to the tag. The parse cache is rebuilt once after updating.
- **No default selection:** in the Search modal and pane, results no longer select their first row; press <kbd>↓</kbd> or click a row. <kbd>Enter</kbd> with nothing selected is **Add to** (see below) instead of acting on the first row, and the breadcrumb's first chip shows the query rather than `search`. <kbd>&lt;</kbd>, <kbd>Alt</kbd> keys and the action panel need a selected row; <kbd>↑</kbd> on the first row clears the selection. Quick Link and `[[` link completion still select the first row.
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
