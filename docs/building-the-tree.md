---
title: Building the tree
---

# Building the tree

Tree Search builds its tree from the structure you already write. There is nothing to configure first: open a vault and the tree is there.

## Headings, bullets and links

Inside a note, three things create parent/child relationships:

- **Headings.** Lines under a heading become its children.
- **Nested bullets.** An indented bullet is a child of the bullet above it.
- **Links in bullets.** A bullet that contains a `[[link]]` is also a child of the linked note. Embeds (`![[image.png]]`, `![[Note]]`) only show content: they don't make the bullet a child of the embedded file.

Here is the `Project Apollo` note from the example vault:

![The Project Apollo note in source mode](assets/screenshots/note-source-apollo.webp)
*`Work/Project Apollo.md`: headings, nested bullets, tasks and links.*

And here is the tree Tree Search builds for it:

![The tree for project apollo](assets/screenshots/tree-apollo.webp)
*Searching for `project apollo`: the note's own outline, plus lines from other notes that link to it.*

The last point matters most. When you write a line in a daily note that links to `[[Project Apollo]]`, that line shows up under Project Apollo. You can keep writing in your daily notes and still find everything by topic later.

## Parents in frontmatter

You can also give a note a parent in its frontmatter:

```yaml
---
parent: "[[Projects]]"
---
```

The key is `parent` by default. You can change it in [Settings](panes-and-integrations.md#settings).

![The tree for projects](assets/screenshots/projects-tree.webp)
*Searching for `projects`. Project Apollo comes in through a bullet in Tree Search Examples; Project Hermes through its frontmatter.*

## What gets indexed

A few rules decide what ends up in the tree:

- **Only the leading outline is indexed.** Tree Search reads the bullets at the start of a note. The first line that is neither a bullet nor a heading ends the outline; blank lines don't. Put your bullets first and any prose after them.
- **A bullet needs a link, a tag or a URL, unless it is a task.** Plain bullets without `[[`, `#tag` or `http` are not indexed on their own. Task lines (`- [ ] …`, `- [x] …`) are always indexed.
- **Nested lines.** A line nested under another text line is a *subtask* (an open task) or *subtext* (anything else), and the line above it is a *list*. Find them with `is:subtask`, `is:subtext` and `is:list`. A bullet that is only a link (`- [[Note]]`) does not make its children nested.
- **Aliases are searchable.** A note with `aliases: [Apollo]` is found when you search for `apollo`.
- **Folders, canvases and attachments are indexed too.** Search for `is:folder` to see folders.
- **Dates.** A line or note gets its date from a `YYYY-MM-DD` in the file name or the line itself. If there is none, Tree Search uses the frontmatter `updated` or `created` field, then your Daily Notes format.

## Archiving

Archive things you no longer need without deleting them. One tag, `#archive`, does it everywhere:

- **a line:** add `#archive` to it, or use the **Archive** action. Everything nested under the line is archived with it;
- **a heading:** put `#archive` on the line immediately below it (for example, `## 2024-12-19\n- item #archive`), or use **Archive** on the heading's row. Its subheadings and every line in its section are archived with it; the tag is not added to the heading text;
- **a whole note:** add `archive` to its frontmatter `tags`, or use **Archive** on the note's row.

Only the whole tag counts: `#archived` or `#archive-old` don't archive anything. A line under an archived line or heading is archived itself, so it is hidden wherever it shows up, also under the notes it links to. To unarchive it, use **Unarchive** on the row that carries the tag (the line, heading or note); a row archived only through its parent has no Archive action.

The tag is `archive` by default and can be changed in [Settings](panes-and-integrations.md#settings).

Notes archived with the older `(meta-mdtree:: archive)` marker are no longer hidden. Run the command **Tree Search: Convert legacy archive markers to #archive** once to rewrite every marker in the vault to the tag.

Archived items are hidden from results. Tree Search collapses them into a single row so you know they are there.

![Search results for hermes with an Archive row](assets/screenshots/archive-hidden.webp)
*Searching for `hermes`: the archived prototype notes are folded into an "Archive (N items)" row.*

Add `is:archived` to your query to bring them back.

![Search results for hermes is:archived](assets/screenshots/archive-revealed.webp)
*`hermes is:archived` shows the archived items, greyed out.*
