---
title: Editor
---

# Editor

Tree Search is not only for finding things. You can write into your vault straight from the search results.

## Quick Add

Select a note row and press <kbd>Alt</kbd>+<kbd>A</kbd>, or click the ⊕ on the row. An editor opens with a `- [[Note]]` bullet ready for you. When you save, the bullets are written into today's daily note, so the new lines show up under that note in the tree.

You can also open it with the **Tree Search: Quick Add** command.

![Quick Add appending to Project Apollo](assets/screenshots/quick-add-append.webp)
*Appending "Confirmed the launch date" under `[[Project Apollo]]`.*

Your draft is kept when you close the editor, and even when you restart Obsidian. It stays until you **Save** (<kbd>Shift</kbd>+<kbd>Enter</kbd> or <kbd>Cmd/Ctrl</kbd>+<kbd>Enter</kbd>) or **Discard** it.

## Linking while you type

Type `[[` in the editor and Tree Search suggests notes from the tree. Press <kbd>Enter</kbd> or <kbd>Tab</kbd> to accept a suggestion.

![Link suggestions while typing a link to Bob](assets/screenshots/insert-link-autocomplete.webp)
*Typing `[[bob` suggests notes from the tree; suggestions start after three characters.*

## Editing a line in place

Select a row and press <kbd>Alt</kbd>+<kbd>Enter</kbd>, or <kbd>Alt</kbd>-click it, to edit that line where it was written.

![Editing the Budget approved line in place](assets/screenshots/alt-edit.webp)
*Editing "Budget approved" without leaving the search.*

## Quick Link

Run the **Tree Search: Quick Link** command while you are writing a note. Search for a note or heading and pick it to insert `[[Note]]` or `[[Note#Heading]]` at your cursor.

![The Quick Link modal searching for apollo](assets/screenshots/quick-link.webp)
*Quick Link for `apollo`.*

## More editing

- **Reparent by dragging.** In Tree mode on desktop, drag a row onto a note row to move it under that note. You can also use **Move under…**.
- **Note content.** Clicking a link in the editor (or pressing <kbd>Alt</kbd>+<kbd>Enter</kbd> on it) opens a content section that is appended to that note. The note is created if it doesn't exist yet.
- **Pasting.** Pasted files are saved into your vault and named after the note. Pasted URLs become markdown links.
- **Indenting.** Press <kbd>Tab</kbd> and <kbd>Shift</kbd>+<kbd>Tab</kbd> to indent and outdent.

See [Shortcuts](shortcuts.md) for every key inside the editor.
