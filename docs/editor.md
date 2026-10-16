---
title: Editor
---

# Editor

Tree Search is not only for finding things. You can write into your vault straight from the search results.

## Quick Add

Select a note row and press <kbd>Alt</kbd>+<kbd>A</kbd>. The Search modal or pane switches to the editor, with a `- [[Note]]` bullet ready for you. When you save, the bullets are written into today's daily note, so the new lines show up under that note in the tree, and you are back at your search with the new line selected. <kbd>Esc</kbd> also takes you back to the search.

The **Tree Search: Quick Add** command (also **Open editor**, <kbd>Alt</kbd>+<kbd>N</kbd> in a search, or **Quick Add** in the action panel) opens the [outline editor](#the-outline-editor) on today's daily note, titled **Quick Add**, with a new line open: type it and press <kbd>Enter</kbd> to save.

![Quick Add appending to Project Apollo](assets/screenshots/quick-add-append.webp)
*Appending "Confirmed the launch date" under `[[Project Apollo]]`.*

Your draft is kept when you close the editor, and even when you restart Obsidian. It stays until you **Save** (<kbd>Shift</kbd>+<kbd>Enter</kbd> or <kbd>Cmd/Ctrl</kbd>+<kbd>Enter</kbd>) or **Discard** it.

## Linking while you type

Type `[[` in the editor and Tree Search suggests notes from the tree. To link a heading, type part of the note name, `#`, then part of the heading: `[[not#hea` finds `Note#Header1` and `Noting#Heading`. Press <kbd>Enter</kbd> or <kbd>Tab</kbd> to accept a suggestion. When no note has the exact name you typed, a **New note `[[name]]`** row sits above the suggestions: press <kbd>↑</kbd> from the first suggestion to select it (it is selected already when nothing matches). It inserts the link; the note is created only if you add content to it.

![Link suggestions while typing a link to Bob](assets/screenshots/insert-link-autocomplete.webp)
*Typing `[[bob` suggests notes from the tree; suggestions start after three characters.*

## The outline editor

The outline editor turns the results in the Search modal or pane into an outline you can browse and edit in place. It opens in one of two modes.

**Explore** (the modal's title says **Explore**) opens with:

- <kbd>Enter</kbd> on a note, a heading or a line with lines under it, clicking a selected row again, clicking a note link in a row, or **Open** in the action panel: the outline opens on that row's whole tree.

<kbd>Enter</kbd> in the search and in explore mode does what fits the row (the footer names it):

| Row | <kbd>Enter</kbd> |
|---|---|
| A note or heading | Explore it: the outline opens on it, or, inside the outline, it becomes the root and joins the breadcrumb |
| A line with a web link | Open the link (e.g. **Browse 🔗 https://…**); the Search modal closes unless you have unsaved edits |
| A line with lines under it | Explore it |
| A task with nothing under it | **Complete task** (on a done task: **Reopen task**) |
| A line with a `` `snippet` `` and nothing under it | **Copy** the snippet; the Search modal closes unless you have unsaved edits |
| Any other line with nothing under it | **Edit** it in place, as <kbd>Alt</kbd>+<kbd>Enter</kbd> does |

A click works differently: clicking a selected row again explores it, whatever it is. A task is completed only by clicking its checkbox, and a snippet is copied only by clicking the snippet itself.

**Edit** (the title says **Edit**) opens with:

- <kbd>Alt</kbd>+<kbd>Enter</kbd>, or **Edit** in the action panel, on a selected note, heading or line: the row turns into an editor right where it is, and the outline opens on the current results around it. With nothing selected (**Edit search**), the outline opens on the current results.
- The ⊕ that appears under the row you point at, or typing <kbd>&gt;</kbd> on a selected row.
- <kbd>&gt;</kbd> with nothing selected: today's daily note, with a new line pre-filled from the search, so `is:task #home` gives `- [ ] #home ` (words, tags and `[[links]]` as typed; `is:completed` gives `- [x] `, `has:link` a trailing `[[`).
- Quick Add (see above).

Above the results, a breadcrumb shows where you are: `search › Project Apollo › Ship the public beta`. Every row is expanded and lines are listed in the order they are written in their notes. The Search modal's title says **Explore** or **Edit** and the root's name. Inside the editor, the ⊕, a note link or <kbd>&gt;</kbd> on a row goes one level deeper, in the same mode; click a crumb to go back up to it.

**Filtering.** Typing in the search box filters the outline: a matching line stays with its parents and everything under it. <kbd>Enter</kbd> turns the text into a crumb (`search › Project Apollo › is:task`) and moves to the rows, so you can narrow further; crumbs add up. If you have picked a row (<kbd>v</kbd> / <kbd>^</kbd>), <kbd>Enter</kbd> acts on it instead (explores or edits it) and the text stays in the search box as the filter. <kbd>Backspace</kbd> in an empty search box drops the last crumb. Lines you edit or add stay listed even when they no longer match the filter, with a red outline.

**Editing a line.** <kbd>Alt</kbd>+<kbd>Enter</kbd> or <kbd>Alt</kbd>-click (in edit mode also <kbd>Enter</kbd> or clicking it again) on a line, a link line or a heading replaces the row with an editor. Its bullet, checkbox or `#` stay as they are. <kbd>Alt</kbd>+<kbd>Enter</kbd> adds a line under it, <kbd>Tab</kbd> and <kbd>Shift</kbd>+<kbd>Tab</kbd> indent and outdent, and `[[`, `@`, pasting and the formatting keys work as described below. A line the filter would hide gets a red outline; you can still save it. <kbd>Enter</kbd> saves (so do <kbd>Ctrl</kbd>+<kbd>Enter</kbd> and <kbd>Shift</kbd>+<kbd>Enter</kbd>): new lines go right where you typed them, each with a `[created:: date]` (or `[scheduled:: date]` for a task). If the line changed in its note in the meantime, nothing is written. <kbd>Esc</kbd> cancels; with changes, press it twice to discard them. On an attachment (an image, a PDF), <kbd>Alt</kbd>+<kbd>Enter</kbd> renames the file, and Obsidian updates the links to it.

**Adding a line.** The **Add to …** row at the end of the results (for example **Add to Project Apollo…**), or **Add to …** in the action panel, adds a line without touching an existing one. Click it, or press <kbd>↓</kbd> past the last row to select it and then <kbd>Enter</kbd>. In the search it is there too: with a row selected (for example **Add to Ship the public beta…**) it explores that row and opens a new line at its end; with nothing selected (**Add to Today…**) it opens a new line at the end of the results. The line goes:

- **Under a note or heading:** into today's daily note, under a link to it.
- **Under a line:** as that line's last child, in its own note.
- **Under the search or today:** into today's daily note.

**Leaving.** Click the `search` crumb, press <kbd>Esc</kbd> in the search box, or <kbd>Backspace</kbd> in an empty search box with no crumb left. You are back at the search you came from, with the same row selected. With unsaved changes, a notice warns you once; leaving again discards them.

### The note's content

A pane above the footer shows the text of the note at the root (for a heading, only the text under it, titled **Note › Heading**), or of the page, link or heading row you are editing, and you can edit it there. <kbd>Enter</kbd> on a note's own row opens just this pane. In explore mode the pane starts collapsed to its title when the note has no text besides its outline, and **Save** and **Discard** (back to the text on disk) show only while you are in the pane. Files you paste or drop into it are saved into your vault and named after the note. A dot by the title marks unsaved changes. **Save**, or <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (<kbd>⌘</kbd>+<kbd>Enter</kbd> on macOS) in the pane, the line editor or the search box, saves the line and the content together. If the note changed in the meantime, nothing is written. The pane's buttons open the note in Obsidian, expand the pane to fill the view, collapse it to its title, or close it. <kbd>Esc</kbd> in the pane goes back to the search box.

To open in Obsidian instead, press <kbd>Shift</kbd>+<kbd>Enter</kbd> (See in Obsidian), choose **Open … in Obsidian** in the action panel, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>-click a link in a row, or click the pane's open button. Folders and attachments still open in Obsidian.

## Quick Link

Run the **Tree Search: Quick Link** command while you are writing a note. Search for a note or heading and pick it to insert `[[Note]]` or `[[Note#Heading]]` at your cursor.

![The Quick Link modal searching for apollo](assets/screenshots/quick-link.webp)
*Quick Link for `apollo`.*

## Move under

To move a note or line, select it and type <kbd>&lt;</kbd>, press <kbd>Alt</kbd>+<kbd>M</kbd>, or choose **Move under…** in the action panel. The row becomes a chip, and the search now looks for its new parent: any note in the vault, not only the ones in the results. Select one and press <kbd>Enter</kbd> (the footer shows **Move under**). <kbd>Alt</kbd>+<kbd>M</kbd> and **Move under…** work in every search view, including on mobile; <kbd>&lt;</kbd> works where you can edit (the Search modal and pane).

![Moving Budget approved under Project Hermes](assets/screenshots/move-under.webp)
*Moving "Budget approved": searching `hermes` for its new parent.*

| You move | It can go under | What changes |
| --- | --- | --- |
| a line | a note or heading | the line, with everything nested under it, moves to today's daily note, under a link to the note or heading |
| a line | another line | it becomes that line's last child, in that line's note |
| a note | another note | its `parent` property (the parent relation in settings) becomes the new note |
| a note, folder or attachment | a folder | the file or folder moves there |

Headings can't be moved; move their note or their lines. If nothing matches what you typed, press <kbd>Enter</kbd> twice to move a note or line under a new note with that name. <kbd>Esc</kbd>, or <kbd>Backspace</kbd> in an empty search box, cancels the move.

A line moved to another note keeps its date: each undated line in it gets `[created:: date]` with the date of the note it came from (the date in its name, its `updated`/`created` property, or its daily note's day).

In Tree mode on desktop you can also drag a row onto a note row in the results to move it under that note. A line dragged to another note keeps its date the same way.

### Moving many rows: the cut drawer

In the Search modal and pane, <kbd>⌘</kbd>+<kbd>X</kbd> (<kbd>Ctrl</kbd>+<kbd>X</kbd> on Windows and Linux) cuts the selected row into a drawer above the footer, and marks it with a dashed outline. Press it again on a cut row to take it out. Collect rows from as many searches as you need: the drawer is shared by the modal and the pane and stays until Obsidian reloads the plugin. The action panel offers the same as **Cut to drawer** / **Take out of drawer**.

The drawer's actions (also in the action panel's **Drawer** section):

- **Move under…** starts a move of every cut row (the chip reads **3 items <**). Pick the new parent and press <kbd>Enter</kbd>: the rows move in the order you cut them, following the table above. A cut line inside another cut line moves with its parent.
- **Archive** archives every cut line and note. Folders and attachments can't be archived.
- **Clear** empties the drawer; **×** takes one row out.

Rows that moved or were archived leave the drawer. The rest stay, and a notice lists why each one failed (for example, a folder can only go under a folder).

## More editing

- **Edit, Rename, Delete.** The action panel's Edit section also has **Edit** (the same as <kbd>Alt</kbd>+<kbd>Enter</kbd>), **Rename [[Note]]** for each note or embedded file on the row (Obsidian updates the links to it), and **Delete**, which asks first. Delete removes a line with everything nested under it, a heading with its section, or moves a note's own row or an attachment to the trash.
- **Note content.** Clicking a link in the editor (or pressing <kbd>Alt</kbd>+<kbd>Enter</kbd> on it) opens a content section that is appended to that note. The note is created if it doesn't exist yet.
- **Pasting.** Pasted files are saved into your vault and named after the note. Pasted URLs become markdown links.
- **Indenting.** Press <kbd>Tab</kbd> and <kbd>Shift</kbd>+<kbd>Tab</kbd> to indent and outdent.
- **Scheduling.** On a task line, type `@` and pick **Today**, **Tomorrow**, **Weekend** (next Saturday) or **Later** (Tuesday next week); keep typing to filter (`@tom`). <kbd>Enter</kbd> or <kbd>Tab</kbd> replaces it with the task's `[scheduled:: date]`, <kbd>Esc</kbd> closes the list. It works in the outline editor's line editor too.

See [Shortcuts](shortcuts.md) for every key inside the editor.
