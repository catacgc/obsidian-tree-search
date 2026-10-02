# Editor mode for Tree and Timeline results

Status: **implemented.** Read this document before changing result rows (`src/view/SearchTreeNode.tsx`, `src/view/search/SearchTimeline.tsx`, `src/view/search/SearchViewFlatten.tsx`) or adding vault writes. Where the implementation differs from the text below:

- **Plain task bullets** (`- [ ] buy milk`) get the "Plain bullets aren't indexed" hint: `shouldSkip` does not index a task without `[[`, `#` or `http`.
- **Tab-indented notes:** lines written into a note whose list lines are tab-indented use one tab per level instead of 4 spaces, because `scanMarkdown` compares raw whitespace lengths.
- **Escape scope:** the editor's Obsidian `Scope` is pushed only while focus is inside the editor, so Escape elsewhere (a note, the search box) keeps its usual meaning.
- **Insert Link** hides archived targets with no "Archive (N)" row and ignores `is:archived` (it now calls `linkTargetTree`).
- **Action panel:** the footer bar and action panel (`docs/superpowers/specs/2026-09-30-search-actions-panel-design.md`) are the entry points on mobile and a keyboard/mouse alternative on desktop (§1, §3.1, §4.1, §5, §6, §8). The mobile long-press has not yet been checked on a device.

Editor mode lets you change the vault from search results without opening notes:

| Feature | Trigger | Tree | Timeline |
|---|---|---|---|
| Append | ⊕ dot at the bottom edge of a note's group, Alt+A, or **Append to [[P]]** in the action panel | yes | yes |
| Edit | hold **Alt/Option**: an edit hint appears; Alt+click or Alt+Enter, or **Edit line** in the action panel | yes | yes |
| Drag / reparent | drag a row onto another note row, or **Move under…** in the action panel | yes | no |

Append and Edit use the same inline editor. It has two sections:

- an **outline** section, always shown: you add to a bullet structure;
- a **content** section for free text, shown only after you click a note link.

Link autocomplete in both sections uses the Insert Link (Quick Link) tree, including headers, in a compact form. You can paste files of any type. The pasted files are named after the note they are pasted under and are renamed on disk when you edit their alias.

## 1. Where it applies

- **Surfaces:** the Search pane (`tree-search:parse-tree`, scope name `"Search"`) and the Search modal (`tree-search:search-modal`, scope name `"modal"`). Quick Link, File context, `tree-context` code blocks and the Consolidate notes pane stay read-only.
- **Gate:** add `allowEditing: boolean` to `SearchViewScope` (`src/view/react-context/state.tsx`). Set it `true` in exactly the places that set `allowTimeline: true` today: `SearchViewPanel.tsx` (`sectionName="Search"`) and `SearchModalContainer.tsx` when `!isQuickLink`. It defaults to `false`.
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

**Placement:** one editor per view, rendered at the **top of the view, above the search block** (`SearchBar` / `TimelineFilterBar`), outside the scrolling results container, so it is always in view in both the pane and the modal. The action footer and panel sit at the bottom of the view (spec `2026-09-30-search-actions-panel-design.md`). It is styled like the search block and search input: `--color-base-00` background, a 1 px `--background-modifier-border` border, the textarea's border turning `--background-modifier-border-hover` on hover/focus, no focus ring, and plain text buttons (Save in the accent color).

From top to bottom:

1. **Header line** (Edit only, small, muted): `Editing <file basename>:<1-based line>`. Append has no header; its parent is the outline's first bullet (§3.2).
2. **Outline section**: a `<textarea>`, always shown (§3.2).
3. **Content section**: a second `<textarea>`, shown only after a note link is clicked (§3.3).
4. **Preview**: a live preview of the focused section, rendered with `MarkdownRenderer.render` and at most 6 lines. It reuses the `MarkdownLine` component from `src/view/organise-notes/PullTreeView.tsx`. Move `MarkdownLine` to `src/view/editor/MarkdownLine.tsx` and import it from both places. Pasted attachments are already on disk (§3.5), so their embeds render in the preview.
5. **Footer hints** (§3.6).

Both textareas are `<textarea>`, not `<input>`: the modal and `activateView` focus the first `input` in the container, so an `<input>` placed before the search box would steal focus. Each one starts at one row and auto-grows up to 8 rows. The outline gets focus on open (`autoFocus` plus `focus()` in an effect), with the caret at the end. Only one editor can be open at a time. Opening an Edit, or an Append while an Edit is open, cancels the open editor (§3.7); choosing a parent while an Append is open re-targets it instead (§4.1).

### 3.2 Outline section

The outline holds the bullets that Append writes under the parent (§4) or the single line that Edit rewrites (§5).

- **Append** opens prefilled with the parent as its first bullet, `- [[P]]\n    - `, and the caret at the end. The user may delete or change the parent line. The blank editor (§4.1) opens with `- `. Every line is a bullet: 4 spaces per level, then `- ` (or `- [ ] `/`- [x] ` for tasks), then text. Rules:
  - Enter starts a new sibling bullet at the same indent, inserting `- `.
  - Tab and Shift+Tab indent and outdent the current bullet by 4 spaces, but never deeper than the previous line's indent + 4.
  - Backspace on a line (not the first) that holds only an indent and a bare marker (`-`, `*`, `+`, optionally `[ ]`/`[x]`) deletes the whole line and puts the caret at the end of the previous line.
  - Pasted multi-line text keeps list lines as they are. Plain lines get a `- ` prefix, and tabs become 4 spaces.
  - On save, empty bullets are dropped.
- **Edit** shows only the editable part of one line (§5). Enter saves, and the line cannot be split.
- **Text-only appends are not allowed.** An Append needs at least one non-empty bullet beyond the untouched prefilled `- [[P]]` line (`appendOutlineEmpty`). Otherwise Save is disabled, with no hint.
- Bullets may be plain text. They are written, but the footer warns that they won't show up in results.
- A line whose text is a heading (`^#{1,6}\s+\S`) blocks Save. Headings belong in a note's content section.

### 3.3 Content section

The content section edits the free-text **content of one note**. It is hidden until the user opens it for a note:

- by clicking a `[[X]]` or `[[X#Header]]` link in the outline textarea (a click whose caret lands inside the link's brackets);
- or with Alt+Enter while the caret is on an outline line: this opens the link under the caret, else the first link on the line, else (in Append) the parent `P`.

Only the page part `X` of the link is used, and headers are ignored. Mod+click on a link opens the note in Obsidian instead, as in the rest of the plugin.

Behavior:
- **Header:** `Content for [[X]]` with a ✕ button. ✕ clears X's buffer and hides the section.
- **Buffers:** there is one text buffer per note name, kept until the editor closes. Clicking another link switches the section to that note's buffer. Notes whose buffer is not empty are shown as small chips (`[[X]]`, `[[Y]]`) in the section header, and clicking a chip switches to that buffer.
- **Text:** free markdown, written verbatim. It can include paragraphs, headings, prose, quotes, tables and embeds. Enter inserts a newline.
- **Where it goes on save** (§4.2): if `X` has no file, the text becomes the body of a new `X.md`. Otherwise it is appended at the end of `X`'s file.

### 3.4 Link autocomplete: the compact Insert Link tree

It works in both sections.

**Trigger:** the text between the last unclosed `[[` before the caret and the caret is the query. The list opens as soon as `[[` is typed.

**Results:** the same pipeline as Insert Link, so both surfaces offer the same targets:
- Extract the Quick Link branch of `SearchModalMolecule` into an exported pure core function `linkTargetTree(graph, query, separator): ResultNode[]` in `packages/core/src/search/search.ts`. It runs `searchIndex` → `pruneResultTree` (keep `page`/`header` nodes whose own key matches the AND of all query stages) → `partitionArchived(…, reveal = false).visible`.
- `SearchModalMolecule` calls it for `isQuickLink`, and the editor calls it for suggestions.
- Hierarchical queries (for example `proj<separator>kick` with the `searchSeparator` setting) work the same way as in Insert Link.
- Flatten with `flattenIndex(results, Infinity)`: the pruned tree only holds matching page/header nodes, so it is shown fully expanded. Keep the first 50 rows.
- For queries shorter than 3 characters (`searchIndex` returns nothing), show one muted row: `Type 3+ characters`.

**Compact rendering** (a new `src/view/editor/LinkSuggest.tsx`, not `SearchAutocomplete` and not `SearchTreeNode`):
- A dropdown absolutely positioned under the active textarea, as wide as the editor, with `max-height` of 8 rows and its own scrolling. It stacks above the search bar that follows the editor (`z-index: 40` over the bar's sticky `z-30`). CSS class `.ts-link-suggest`.
- Rows are 22 px high with `var(--font-ui-small)`, a 12 px indent per tree level, and a 12 px lucide icon: `FileText` for a page with a file, `File` (muted) for a reference page with no file, `Hash` for a header.
- The label is the page name or the header text, with matched terms highlighted like the result rows. Rows have no age, breadcrumbs, action buttons, chevrons or hover preview.
- The highlighted row has `.is-selected`, and the first row is highlighted by default.

**Keys** (while the list is open): ArrowUp/ArrowDown move the highlight, Enter or Tab accepts (Shift+Enter still saves, Shift+Tab still outdents), and Escape closes the list. Hovering highlights a row, and mousedown accepts it (with `preventDefault` so the textarea keeps focus).

**Accept:** replace the text from `[[` to the caret, plus a directly following `]]` if there is one, with `reverseMarkdownParsing(node)`, which gives `[[Page]]` or `[[Page#Header]]`. The caret goes after the closing `]]`.

**New names:** there is no "create" row. Typing `[[New name]]` by hand leaves a link to a page that doesn't exist yet. It becomes a file only if content is entered for it (§4.2).

### 3.5 Pasting attachments

A paste whose `clipboardData.files` is not empty is handled by the editor (`preventDefault`) in either section. **Any file type** is accepted. Each file is **written to disk immediately**.

**Base note** (whose name the attachment is named after):
- Append outline: the first page link on the caret's line, else the nearest line above with a smaller indent that has a page link, else the parent `P`.
- Edit line: the first page link on the line, else the basename of the row's `location.path`.
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

All keys are handled in the textareas' `onKeyDown`, always with `stopPropagation()` so `KeyComboWrapper` never sees them. An open autocomplete list takes precedence (§3.4).

| Key | Outline | Content |
|---|---|---|
| Enter | Append: new sibling bullet. Edit: save. | Newline |
| Mod+Enter / Shift+Enter | Save | Save |
| Tab / Shift+Tab | Append: indent / outdent the bullet | Browser default |
| Backspace | Append: on a bare-bullet line, delete the whole line (§3.2) | Browser default |
| Alt+Enter | Open the content section for the link at or near the caret (§3.3) | — |
| Escape | Cancel the editor and focus the search input (the Cancel button does the same) | Hide the section and return focus to the outline (the buffer is kept) |
| Mod+B / Mod+I | Wrap the selection in `**…**` / `*…*` | same |
| Mod+K | Wrap the selection as `[selection](url)` and select `url` | same |

Escape must **not** close the modal. While the editor is mounted, push an Obsidian `Scope` with `app.keymap.pushScope(scope)`, register `scope.register([], "Escape", () => { handleEscape(); return false })`, and `popScope` on unmount.

### 3.7 Hints, errors, save and cancel

**Footer hints:** a muted footer, recomputed on each change. Blocking hints disable Save. An empty Append outline (§3.2) also disables Save, without a hint.

| Condition | Hint | Blocks save |
|---|---|---|
| Outline line is a heading | `Headings go in a note's content — click [[P]]` (`click a [[link]]` when there is no parent) | yes |
| Ambiguous attachment embed | see §3.5 | yes |
| Invalid new note or attachment name | see §7 | yes |
| Edit line empty | `Empty — use Archive to remove the line` | yes |
| Outline bullet with no `[[`, `#tag`, `http`, task checkbox or embed | `Plain bullets aren't indexed — they won't appear in results` | no |
| `[[X]]` with no file and an empty buffer (except the parent `P`) | `[[X]] stays a link without a note — click it to add content` | no |
| `[[X]]` with no file and a buffer | `Creates note "X"` | no |
| Buffer for an existing note `X` | `Appends to X.md` | no |

**Save:** the steps are listed in §4.2 (Append) and §5 (Edit). They run in order. The editor remembers the steps that finished, so after a failure, Save again runs only the remaining steps and never writes content twice. A failed step shows an Obsidian `Notice` with the message and the files already written, and the editor stays open with all text intact.

**Success:**
1. Close the editor and focus the search input (unless another editor was opened while saving).
2. Reindex every touched markdown file as described in §2.
3. Keep the query and scroll position. The re-run search shows the new rows.

**Cancel** (Escape in the outline, opening another editor as in §3.1, or unmounting the view or modal while the editor is open): trash all session attachments with `app.fileManager.trashFile` and discard the buffers. Nothing else was written.

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

**Re-targeting:** choosing a parent (⊕ or Alt+A) while an Append editor is open keeps the session (typed text, content buffers, attachments) and swaps the parent line (`replaceOutlineParent`): a link-only first line `- [[X]]` becomes `- [[P]]`; a blank outline becomes the prefill; otherwise `- [[P]]` is prepended, and a root-level outline is indented under it. The outline keeps focus.

**Blank editor:** **Open editor** (⌥N) in the action panel's View section, Alt+N in the Search pane or modal, and the `tree-search:open-editor` command ("Open editor", no default hotkey; opens the Search modal with the editor focused) open an Append editor with outline `- ` and no parent. The search bar has no button for it. Its root bullets go to today's daily note as root bullets. If an Append editor is already open, they focus it instead.

**Insert After:** in views with editor mode, the `Insert After` action (Ctrl+I or Alt+I) opens Append for the selected row, exactly like Alt+A, instead of inserting a line in the Obsidian note. The modal stays open to host the editor. The action panel lists it only in views without editor mode, where **Append to [[P]]** doesn't exist. Views without editor mode, and Raycast, keep the Obsidian insert.

All search-view shortcuts, including the editor ones (Alt+A, Alt+Enter, Alt+N, Alt+I) and ⌘K / Ctrl+K for the action panel, are defined once in `src/view/search/shortcuts.ts`. `KeyComboWrapper` and the action panel both run them through `useShortcutHandlers` (`src/view/search/shortcut-handlers.ts`), and the Shortcuts section of the Search modal's help panel lists them. Alt shortcuts are matched by `event.code`. On macOS, Option+N and Option+I are dead keys: their `˜`/`ˆ` composition ignores keydown `preventDefault` and arrives after the editor has taken focus. So every handled Alt shortcut calls `swallowDeadKey` (`src/view/editor/dead-key.ts`), which ends that composition and restores the field it landed in. Inside the editor's textareas Option+N/Option+I are left alone, so `ñ`/`î` can still be typed.

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
3. **Outline:** write the outline into today's daily note (placement below), keeping relative indents. Links to notes created in step 2 are already in the text, so those notes appear under `P`.

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
- **Edit line** in the action panel's Edit section, shown only for editable rows. This is the mobile entry point; on mobile a long-press opens the panel, not the editor.

**Editable rows:**
- text rows;
- header rows;
- **child** page rows, i.e. Tree indent > 0, or Timeline page rows whose `location.path` is not the page's own file. Their location is the bullet that wrote the relation, e.g. `- [[Page]]` in a daily note.

Not editable: root page rows (their location is line 0 of the page's own file), folder, attachment and month rows, and the Archive row.

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

**Obsidian appliers** in `src/editing/vault-edits.ts`: `pasteAttachment`, `applyAttachmentPlan`, `trashSessionAttachments`, `writeNoteContents`, `appendToDailyNote`, `editLine`, `reparent`, `getOrCreateDailyNote`. They are the only callers of `vault.process`/`create`/`createBinary`/`processFrontMatter`/`renameFile`/`trashFile` for editor mode, and they return the list of touched markdown `TFile`s so the UI can reindex them.

**UI:**
- `src/view/editor/InlineEditor.tsx` (Edit header, both sections, preview, footer), `src/view/editor/LinkSuggest.tsx` (the compact tree), `src/view/editor/MarkdownLine.tsx` (moved), `src/view/editor/editor.css`, `src/view/editor/textarea-ops.ts` (pure textarea edits: `appendPrefill`, `outlineBackspace`, `replaceOutlineParent`, …).
- Editor state atoms go in a new `EditorMolecule` scoped like `SearchViewMolecule`. The editor state is `{ mode: "append" | "edit"; target?: TreeNode; parentName?: string; originalLine?: string; outline: string; contents: Record<string, string>; activeContent: string | null; attachments: SessionAttachment[]; doneSteps: string[]; focusNonce: number } | null`. `isSaveBlocked` combines blocking hints and `appendOutlineEmpty`. `GlobalAtoms.editorRequestAtom` carries the `open-editor` command to the Search modal.
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
- **Live check** per AGENTS.md "Live Obsidian Testing" on a dev vault:
  - type `[[` plus a query and check that the compact tree lists pages and headers like Insert Link;
  - append an outline with a new note that has content, plus a pasted image renamed by alias (check the file name on disk and the embed);
  - cancel an editor after pasting and check that the file was trashed;
  - Alt-edit a row;
  - drag a daily-note child to a new parent;
  - confirm the rows update without a manual refresh and that `await tab.errors()` is empty.
