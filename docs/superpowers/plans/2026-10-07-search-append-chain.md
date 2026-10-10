# Search append chain (`>`) and reparent (`<`)

## Context

In the Search modal and Search pane (the views with `allowEditing`), typing `>` turns the selected result, or today's daily note when nothing is selected, into a chip: `[RaO >]`. The input after the chip searches only that node's descendants, and another `>` drills one level deeper. Text that doesn't match a row is written under the chip's node, with a rendered preview first. Multi-line prose opens a full-note prose editor in Quick Add. Typing `<` moves the selected row instead: `[RaO <]`, then you search for the new parent. In these views this replaces the "Move To" folder action. The tables below are the behavior spec for review, and the Approach steps implement exactly them.

Decisions already made by the user:
- In-note appends get a date stamp: tasks get `[scheduled:: today]`, other lines get `[created:: YYYY-MM-DD]`.
- Bullets that carry `[created:: date]` are indexed.
- A header target goes to today's daily note under `- [[P#H]]`.
- `[Today >]` with prose opens the prose editor on today's daily note.
- Enter writes immediately.
- Moving a line puts it in today's daily note, stamped with its original date.

## Behavior spec

### Append chain: where each combination is written

"Today" means today's daily note (`dailyNotePath(dailyConfigOf(index))`). "Stamp" means `stampAppendedLine`, defined in step 1: an open task without a date gets ` [scheduled:: <today>]`, and any other list line without a `YYYY-MM-DD` gets ` [created:: <today>]`. Headings are never stamped.

|#|Chain (examples)|Written to|How|Date|
|---|---|---|---|---|
|1|`[Today >] [ ] new task` · `[Today >] met [[Bob]]`|Today|Root bullet(s) at the outline end (`appendToDailyNote`)|Tasks: `scheduleUnscheduledTasks` (existing). Text: dated by the daily note|
|2|`[Today >] # Plan` · `[Today >] [# Plan >] [ ] task`|Today|Heading, then the bullets under it, inserted at the outline end (`pasteAtOutlineEnd`)|Not stamped (the daily note dates them)|
|3|`[Today >] \| alias`|Today's frontmatter `aliases`|Appended to the list; Notice if it is already there|n/a|
|4|`[Today >]` + pasted multi-line prose, or Alt+Enter|Prose editor on today's note|Buffer = the whole daily note + `appendContent(…, prose)`. Save replaces the file. If the outline or frontmatter changed, a second Save confirms|n/a|
|5|`[Page >] [ ] task` · `[Page >] note [[X]]` · pasted list|Today|Under `- [[Page]]` (merged into an existing `[[Page]]` bullet)|`scheduleUnscheduledTasks` (existing)|
|6|`[Page >] # New header` · `[Page >] [# New header >] [ ] task`|`Page.md` (created when Page is a reference)|Heading + bullets at Page's outline end, so they stay inside the indexed leading outline|Stamp bullets|
|7|`[Page >] \| alias`|`Page.md` frontmatter `aliases` (file created if missing)|Appended; Notice on a duplicate|n/a|
|8|`[Page >]` + pasted prose, or Alt+Enter|Prose editor on `Page.md`|As row 4. A reference page has an empty buffer + prose, and Save creates `Page.md`|n/a|
|9|`[Page#H >] [ ] task` · text · list|Today|Under `- [[Page#H]]` (merged into an existing bullet)|`scheduleUnscheduledTasks`|
|10|`[task/line >] [ ] subtask` · `[line >] check price` · pasted list|The line's own file (`row.node.location.path`)|Last children of that line (`pasteUnderLine`)|Stamp every line, even when that file is Today, because the stamp is what makes a plain line indexed|
|11|`[line >]` + pasted prose, or Alt+Enter|Prose editor for a **new note**|Name field prefilled from the first line. Save creates the note, then appends ` [[Name]]` to the line, which makes the new note the line's parent (reversed relation; accepted)|n/a|
|12|`[Page >] [Meeting [[Bob]] >] [ ] follow-up` (typed text + `>` makes a "new" chip)|Wherever the anchor (the last existing chip) writes|The new chips are written as nested parents of the entry, in one write|The anchor's rule|
|13|`[Page >] [child row >] …`|Rule of the child's type|page → 5–8, header → 9, line → 10–11|—|
|14|`[Page#H >] # x` · `[line >] # x` · `[line >] \| x` · `[Page#H >] \| x`|nothing|Preview shows the error: `Headings can't go under a header — pick its page` / `Headings can't go under a line` / `Aliases apply to pages`|—|
|15|`>` on a folder, attachment, month, folder-note, pointer or Archive row|nothing|Notice `Can't add under this row`|—|
|16|`[Page >] [new chip >]` + prose · heading after a bullet chip|nothing|Errors `Prose can't go under a new entry` / `A heading can't go under a bullet`|—|

### Reparent (`<`): where each move is written

|#|Chain|Results offered|Written to|How|
|---|---|---|---|---|
|R1|`[Page <] Other page`|Pages (`linkTargetTree` pruned to pages) + folders|`Page.md` frontmatter `parentRelation`|Absent → `"[[New]]"`. When the row's tree parent page is an entry, replace that entry. Else a string → `"[[New]]"`, an array → append `"[[New]]"`. Bullet relations in other notes are untouched|
|R2|`[Page <] Folder`|same|File system|`fileManager.renameFile(file, folder/file.name)`. Notice if the name is taken|
|R3|`[Page <] typed name` with no rows, then Enter twice|—|`Page.md` frontmatter|As R1, with `[[typed name]]` (a reference page; no file created)|
|R4|`[line <] Page` / `[line <] Page#H`|Pages, headers, lines (archived hidden; the line itself excluded)|Today|Cut the line's subtree from its file, paste under `- [[Page]]` / `- [[Page#H]]` in Today. If the source is a dated periodic note other than Today, every indexed line in the block that has no date gets ` [created:: <source date>]`|
|R5|`[line <] other line`|same|The target line's file|Cut, then paste as the last children of the target line. Same stamp rule when the files differ. Refused (`Can't move a line under itself`) when the target is inside the moved subtree|
|R6|`[line <] typed name` with no rows, then Enter twice|—|Today|As R4, with `- [[typed name]]`|
|R7|`<` on a header, folder, attachment, month or Archive row|—|nothing|Notice `Only pages and lines can be moved`|
|R8|`<` on a child line whose own text links its tree parent|—|nothing|Notice with the existing `INLINE_LINK_REFUSAL` text|

### Keys and input (SearchBar; only when `allowEditing`)

|Key|When|Effect|
|---|---|---|
|`>`|`separatorAtom` ≠ `>`; chain is not reparent; no paste block|Push a chip (rules in step 5). `preventDefault`, so the character is not typed|
|`<`|separator ≠ `<`; a selected row|Start reparent with that row (this replaces any append chain)|
|Backspace|input empty, caret at 0|Clear the paste block, else pop the last chip and restore the query typed before it; popping the last chip leaves chain mode|
|ArrowUp / ArrowDown|append chain, add row visible|ArrowUp on the first visible row selects the add row; ArrowDown from the add row selects the first visible row|
|Enter|append chain, add row selected|Commit (table rows 1–13)|
|Enter|reparent|A selected row → move. No rows and non-empty input → the first Enter arms the confirm prompt, a second Enter with the same input moves|
|Alt+Enter|append chain|Open the prose editor for the anchor (rows 4/8/11) with the typed text or paste as the initial prose|
|paste containing `\n`|append chain|Store it as the paste block (chip `N lines ✕`); the input becomes read-only until it is cleared|
|Clear button ×|any|Clear the chain, the paste and the query|

The input is "entry input" (not a search) when its trimmed start matches `/^(\||#{1,6}\s|\[[ xX]\]\s|[-*+]\s|\[\[)/`. Entry input shows no result rows, only the add row.

## Approach

Each step leaves `bun test` and `bun run build` green. Steps 1–2 are independent of each other. Step 3 depends on 1. Steps 4–5 depend on 3. Step 6 depends on 2–5. Step 7 depends on 5.

### 1. Core primitives (`packages/core`)

- `parser/list-scanner.ts`:
  - export `CREATED_FIELD_RE = /\[created::\s*\d{4}-\d{2}-\d{2}\s*\]/`;
  - export `isProseText(text: string): boolean` (no `[[`, `![[`, `#` or `http`, the body of today's check);
  - in `shouldSkip(text, archiveTag, isTask)`, after the archive check: `if (CREATED_FIELD_RE.test(text)) return false`, then `return isProseText(text)`.
- `graph/indexer.ts` `shouldSkip(lst)`:
  - add `if (CREATED_FIELD_RE.test(lst.text)) return false` before the final check;
  - replace `isOnlyText(lst.text)` with the imported `isProseText`;
  - delete `isOnlyText`.
- `edit/outline-edit.ts`:
  - Widen `LINK_ONLY_RE` to `/^\[\[([^\]|]+)(\|[^\]]*)?\]\]$/`, so `[[P#H]]` is a link-only bullet for `linkOnlyTarget`, `appendOutline` merging, `pasteUnderLinkBullet` and `scheduleUnscheduledTasks`. Update the doc comments (page or `page#header`).
  - Add `pasteUnderLine(content: string, headLine: number, expectedHead: string, block: string[]): {content: string; line: number}`:
    - throw `StaleLineError` when `lines[headLine] !== expectedHead`;
    - `depth = Math.floor(indentWidth(head) / 4) + 1`;
    - insert at `findSubtreeEnd(lines, headLine)`, with `block.map(l => l === "" ? "" : indentBy(l, depth, indentUnitOf(lines)))`;
    - `line` = the insertion index.
  - Add `outlineChanged(before: string, after: string): boolean`: compares `lines.slice(0, outlineEndOf(lines))` of both (via `splitLines`; this includes the frontmatter).
  - Export both from `src/index.ts` next to `pasteAtOutlineEnd`, together with `CREATED_FIELD_RE` and `isProseText`.
- `edit/task-edit.ts`:
  - `addCreatedField(line: string, date: string): string | null`:
    - null unless `LIST_ITEM_RE` matches and the line has no `/\d{4}-\d{2}-\d{2}/`;
    - else insert ` [created:: date]` before a trailing ` ^blockid`, using the same splice `scheduleTask` uses.
  - `stampAppendedLine(line: string, today: string): string`:
    - an open task → `scheduleTask(line, today) ?? line`;
    - else `addCreatedField(line, today) ?? line`.
  - `stampMovedBlock(block: string[], date: string): string[]`: for each list line where the item is a task or `!isProseText(text)`, apply `addCreatedField(l, date) ?? l`.
  - Export all three.
- `edit/editor-hints.ts`:
  - widen `mode` to `"append" | "edit" | "prose"` and add the inputs `proseNewName?: string`, `proseOutlineChanged?: boolean` and `proseConfirmed?: boolean`;
  - the prose branch:
    - blocking `Empty — nothing to save` when the outline is blank;
    - with `proseNewName !== undefined`: blocking `Name the new note` when it is blank, `NAMES_HINT` when it matches `INVALID_NAME_RE`, `Note "<name>" already exists` when `noteExists`;
    - info `This changes the note's outline or frontmatter — press Save twice to confirm` (unconfirmed) or `Outline changes confirmed — Save writes them` (confirmed) when `proseOutlineChanged`;
    - the attachment-error hints;
    - skip the outline-issue and link-name loops.
  - Export `PLAIN_HINT`.

### 2. Appliers (`src/editing/vault-edits.ts`, `src/indexing/indexed-tree.ts`)

- `IndexedTree.periodicDateOf(path: string): number | null` returns `this.periodicDate(path)`.
- `appendBlockAtOutlineEnd(app, file: TFile, lines: string[]): Promise<{file: TFile; line: number}>`: `vault.process(file, c => { line = findOutlineEnd(c); return pasteAtOutlineEnd(c, lines) })`.
- `appendUnderLine(app, path, line, expectedHead, block): Promise<{file: TFile; line: number}>`: `vault.process` + `pasteUnderLine`. A missing file throws `StaleLineError`.
- `noteFileFor(app, name, sourcePath): Promise<TFile>`: `getFirstLinkpathDest(name, "")` or `vault.create(newNotePath(app, name, sourcePath), "")`. Reuse `newNotePath`.
- `addAlias(app, file: TFile, alias: string): Promise<TFile[]>`, via `processFrontMatter`:
  - normalize `fm.aliases` (missing → `[]`, string → `[s]`);
  - a case-insensitive duplicate throws `Error('"<alias>" is already an alias of <basename>')`;
  - else push.
- `writeWholeNote(app, path, original: string | null, text: string): Promise<TFile>`:
  - `original === null`: throw `Error("Note changed since editing started — reopen the editor")` if the file now exists; else create the parent folder when missing (same as `getOrCreateDailyNote`) and `vault.create(path, text)`;
  - otherwise `vault.process(file, c => { if (c !== original) throw <same Error>; return text })`.
- Extend `ReparentPlan` with:
  - `{kind: "set-parent"; childPath: string | null; childName: string; relation: string; newName: string; oldName: string | null}`:
    - with `childPath === null`, the applier first creates the note through `noteFileFor(app, childName, <today>)`; the plan carries `cfg: DailyNoteConfig` for that;
    - then `processFrontMatter` with the R1 rule, matching entries by the existing `linkName`.
  - `{kind: "to-folder"; childPath: string; folderPath: string}`:
    - destination = `folderPath === "/" ? file.name : \`${folderPath}/${file.name}\``;
    - throw `Error("<file.name> already exists in <folderPath>")` if the destination is taken;
    - else `renameFile`.
  - `{kind: "to-daily"; sourcePath; line; head; parentLink: string; cfg: DailyNoteConfig; stampDate: string | null}`:
    - `daily = await getOrCreateDailyNote(app, cfg)`;
    - when `daily.path === sourcePath`: one `process` that runs `cutSubtree` → `pasteUnderLinkBullet(c, parentLink, block)` (no stamp);
    - otherwise:
      - read the source and `cutSubtree` it to validate and get `block`;
      - `block = stampDate ? stampMovedBlock(block, stampDate) : block`;
      - `process(daily, pasteUnderLinkBullet)`;
      - then `process(source, cutSubtree(...).content)`, which on `StaleLineError` throws `Error("Copied to today's daily note but the original line changed — remove it manually")`.
  - `{kind: "under-line"; sourcePath; line; head; targetPath; targetLine; targetHead; stampDate: string | null}`:
    - same file:
      - one `process`: `cutSubtree`;
      - if `line <= targetLine < line + block.length` throw `Error("Can't move a line under itself")`;
      - shift `targetLine -= block.length` when it was after the cut;
      - then `pasteUnderLine` (no stamp).
    - cross file: paste into the target first (stamped), then cut, with the `Copied to …` error naming the target basename.
  - The existing kinds and their drag/Move under callers stay unchanged.

### 3. Pure chain model — new `src/view/search/chain.ts`

No equivalent exists. It holds only types and pure functions, imported by the state and UI code.

```ts
export type RowRef = {node: ParsedNode; label: string; parent: ParsedNode | null}   // node keeps the row's location; parent = tree parent row's node (Tree mode), else null
export type ChainEntry =
  | {kind: "empty"}
  | {kind: "alias"; alias: string}
  | {kind: "heading"; level: number; text: string}
  | {kind: "outline"; lines: OutlineLine[]; multiline: boolean}
  | {kind: "prose"; text: string}
export type ChainTarget = {kind: "daily"} | {kind: "node"; row: RowRef} | {kind: "new"; entry: ChainEntry}
export type ChainLink = {target: ChainTarget; prevQuery: string}
export type ChainState =
  | {mode: "append"; links: ChainLink[]}                      // links non-empty; "new" targets only after all daily/node ones
  | {mode: "reparent"; child: RowRef; prevQuery: string; confirm: string | null}
export type ChainCommit =
  | {kind: "daily-outline"; outlineText: string}
  | {kind: "note-block"; noteName: string | null; lines: string[]; stamp: boolean}   // null = Today
  | {kind: "under-line"; row: RowRef; lines: string[]}               // always stamped
  | {kind: "alias"; noteName: string | null; alias: string}
  | {kind: "prose-note"; noteName: string | null; text: string}
  | {kind: "prose-new"; row: RowRef; text: string}
  | {kind: "error"; message: string}
```

- `isEntryInput(text)`: the regex from the Keys section.
- `parseChainEntry(text)`:
  - normalize `\r\n` → `\n` and trim the trailing whitespace;
  - multi-line: an `outline` with `multiline: true` (`parseOutline(t).lines`) when every non-blank line matches `LIST_ITEM_RE`, else `prose`;
  - single line `s = t.trim()`:
    - `""` → empty;
    - `/^\|\s*(.*)$/` → alias;
    - `/^(#{1,6})\s+(\S.*)$/` → heading;
    - else `outline` from `parseOutline(LIST_ITEM_RE.test(s) ? s : "- " + s)`.
- `blockLines(news: ChainEntry[], entry: ChainEntry): string[] | {error: string}`:
  - start at `depth = 0`;
  - a heading at `depth > 0` → error `A heading can't go under a bullet`; a heading pushes `"#".repeat(level) + " " + text` and keeps `depth`;
  - an outline pushes `renderOutline(lines, depth)`, and a news outline then does `depth++`;
  - an empty entry adds nothing.
- `planChainCommit({links, entry, rawText, dailyPath, forceProse}): ChainCommit`:
  - anchor = the last `daily`/`node` target (none → daily); news = the `new` targets after it;
  - apply table rows 1–16 in this order: prose (`forceProse` or `entry.kind === "prose"`; the text is `rawText`) → alias → `blockLines` → heading present → outline;
  - `under-line` lines are always stamped by the executor (no flag);
  - page `outlineText` = `["- [[P]]", ...lines.map(l => "    " + l)].join("\n")`, and a header uses `[[P#H]]`.
- `planReparent(child: RowRef, target: ParsedNode | {nodeType: "newPage"; name: string}, ctx: {ownPath: OwnPath; relation: string; cfg: DailyNoteConfig}): ReparentPlan | {error: string}`:
  - implements R1–R6 with `head`/`targetHead` left `""` and `stampDate: null`; the atom in step 6 fills them;
  - `oldName` = `child.parent?.nodeType === "page" ? child.parent.page : null`;
  - a reference page child with a folder target → error `[[X]] has no note to move`.
- `chainResults(graph, chain, query, separator, options, dailyPath): ResultNode[]`:
  - append mode, entry input or a "new" anchor → `[]`;
  - daily → `advancedSearch(graph, \`[[${basenameOf(dailyPath)}]]\`, query, separator)`;
  - node → `advancedSearch(graph, getKey(row.node), query, separator)`;
  - then `partitionArchived(r, extractArchiveReveal(parseQuery(query, separator)).reveal).visible`;
  - reparent: `query.trim().length < 3` → `[]`;
    - page child → `[...pruneResultTree(linkTargetTree(graph, query, separator), n => n.nodeType === "page" && getKey(n) !== key), ...pruneResultTree(searchIndex(graph, \`${query} is:folder\`, separator, options), n => n.nodeType === "folder")]`;
    - text child → `pruneResultTree(partitionArchived(searchIndex(graph, query, separator, options), false).visible, n => ["page", "header", "text"].includes(n.nodeType) && getKey(n) !== key)`.
- `describeCommit(c: ChainCommit, todayLabel: string): string`, the add row's destination line:
  - `Today's daily note`, `Today's daily note, under [[P]]` (or `[[P#H]]`);
  - `P.md, end of its outline`;
  - `Under "<label>" in <basename>`, with `· dated <today>` appended for `under-line` and for a stamped `note-block`;
  - `Alias of [[P]]`;
  - `Prose editor: <P>.md` and `Prose editor: new note linked from "<label>"`;
  - errors verbatim.
- `chipLabel(target)`:
  - `Today`;
  - the row: `nodeLabel(node)` (from `timeline-utils.ts`), cut to 40 characters with `…`;
  - a new entry: its raw text.

### 4. Chain state and results (`src/view/react-context/state.tsx`, `src/view/SearchPage.tsx`)

- In `SearchViewMolecule`:
  - `chainAtom = atom<ChainState | null>(null)`, `chainPasteAtom = atom<string | null>(null)` and `chainAddSelectedAtom = atom(false)`;
  - `chainCommitAtom`: a derived `ChainCommit | null` from `planChainCommit`, or null when not in append mode or when the add row is hidden. The add row is visible when the query is non-blank, a paste is set, or the chain has `new` links. Return all four from the molecule.
  - `selectedLineAtom`'s setter also sets `chainAddSelectedAtom` to false.
- `refreshChainResultsAtom` (write-only):
  - computes `chainResults(...)`, then `set(updateSearchResultsAtom, results)`;
  - then sets `chainAddSelectedAtom` to `addRowVisible && (results.length === 0 || isEntryInput(query) || paste !== null)`.
- `pushChainAtom`, `popChainAtom`, `startReparentAtom(): void` and `clearChainAtom`, with the step-5 rules. They read `selectedNodeAtom`, `renderableTreeNodesAtom` and `treeParentPos` (`row-editing.ts`) for `RowRef.parent` (Tree mode only), and `GlobalAtoms.indexAtom` for `dailyPath`.
- `SearchModalMolecule.searchResultsComputeAtom`: right after reading `actualQueryAtom`, `get` `chainAtom` and `chainPasteAtom`. When the chain is non-null, `set(searchMol.refreshChainResultsAtom)` and return.
- `_SearchPage`: read `chainAtom`/`chainPasteAtom`, add both to the effect deps, and call `refreshChainResults()` instead of `props.searchFn` when the chain is non-null.
- `searchPlaceholderAtom`:
  - append chain: `Search under <chipLabel>, or type to add`;
  - reparent: `Move <label> under…`.

### 5. SearchBar, chips, add row (`src/view/search/SearchBar.tsx`, new `ChainPreview.tsx`, `SearchViewFlatten.tsx`, `styles.css`)

- `handleKeyDown`: keep the suggestion handling first. Then, only when `scp.allowEditing`, implement the Keys table. Every handled key calls `preventDefault()` and `stopPropagation()`, so KeyComboWrapper never sees it (Enter, Alt+Enter, arrows).
- `pushChainAtom` rules (the query is `actualQuery`):
  1. Ignore when there is a paste block or the chain is in reparent mode.
  2. Entry input: push `{kind: "new", entry}` only for a heading or a non-multiline outline entry; else ignore.
  3. Else, a selected row (and the add row not selected) that is not `archiveRow`:
     - page, header or text → `{kind: "node", row}`;
     - a page whose name equals the daily basename (case-insensitive) → `{kind: "daily"}`;
     - other node types → Notice `Can't add under this row`, no push.
  4. Else a blank query with no chain → `{kind: "daily"}`.
  5. Else a non-blank query → `{kind: "new", entry: parseChainEntry(query)}` if it is a heading or a single-line outline.
  6. The push records `prevQuery = query` and sets the query to `""`.
- `startReparentAtom`:
  - needs a selected non-archive row;
  - a header, folder, attachment, month or other type → Notice `Only pages and lines can be moved`;
  - a text row with `indent > 0` whose `dragInfo(rows, pos).refusal === INLINE_LINK_REFUSAL` → Notice with that text;
  - else `{mode: "reparent", child, prevQuery: query, confirm: null}` and the query `""`.
- `onPaste` on the input: in append mode, when `clipboardData.getData("text/plain")` contains `\n`, `preventDefault` and set `chainPasteAtom`.
- Render the chips before the input, inside the same flex row:
  - append: `<span class="ts-chain-chip">{label} &gt;</span>`;
  - reparent: `ts-chain-chip is-reparent` with `<`;
  - paste: `ts-chain-chip is-paste`, `{n} lines` plus a ✕ button that clears the paste.
  - The input gets `readOnly` while a paste is set. The Clear button calls `clearChainAtom` and clears the query.
- `ChainPreview` sits between `SearchBar` and the results in `SearchViewFlatten`, shown when the add row is visible or a reparent prompt applies. It shows:
  - the `describeCommit` line;
  - for outline, heading and alias commits, the block rendered with `MarkdownLine` (`src/view/editor/MarkdownLine.tsx`; prose shows its first 6 lines);
  - `PLAIN_HINT` when the commit is `daily-outline` and `parseOutline(outlineText).issues` has `plain`;
  - errors with `is-blocking`.
  - The root gets `.is-selected` when `chainAddSelectedAtom`. A click commits, with mousedown `preventDefault` to keep the input focus.
  - In reparent mode it shows `Type 3+ characters`, `No match — press Enter to create [[<q>]]`, the armed `Create [[<q>]] and move <label> under it? Press Enter again`, or `Names can't contain \ / : * ? " < > |`.
- CSS: add `.ts-chain-chip` (accent border, pill), `.ts-chain-preview` and `.ts-chain-preview.is-selected` (the selected-row background), reusing the existing selection variables in `styles.css`.

### 6. Writes and the prose editor (`EditorMolecule.ts`, `draft.ts`, `quick-add-flow.ts`, `InlineEditor.tsx`, `editor.css`)

- `commitChainAtom(opts?: {prose?: boolean})`:
  - plan with `forceProse = opts.prose`; `rawText = paste ?? query`;
  - an `error` → no-op;
  - execute:
    - `daily-outline` → `appendToDailyNote(app, parseOutline(scheduleUnscheduledTasks(outlineText, today)).lines, cfg)`;
    - `note-block` → `appendBlockAtOutlineEnd(app, noteName ? await noteFileFor(app, noteName, dailyPath) : await getOrCreateDailyNote(app, cfg), stamp ? lines.map(l => stampAppendedLine(l, today)) : lines)`;
    - `under-line` → `readLine` + `LIST_ITEM_RE` + `lineHasIdentity` guard (fail → `markOutOfDate`), then `appendUnderLine(app, path, line, head, lines.map(l => stampAppendedLine(l, today)))`;
    - `alias` → `addAlias` on `noteFileFor`/`getOrCreateDailyNote`, plus Notice `Added alias "<a>" to <name>`;
    - `prose-*` → `openProseAtom`.
  - On success, in this order:
    1. the chain keeps only its non-`new` links (`[{kind: "daily"}]` if none are left), the query becomes `""` and the paste null;
    2. `set(GlobalAtoms.pendingSelectAtom, {view: scp.name, targets: [{path, line}], flash: true})`, skipped for alias;
    3. `refreshPaths`.
  - `StaleLineError` → `markOutOfDate`; any other error → `new Notice(message)`.
- `reparentChainAtom(target: ParsedNode | {nodeType: "newPage"; name: string})`:
  - `planReparent`;
  - for line plans: `readLine` the head and check it (`LIST_ITEM_RE` + `lineHasIdentity`); for `under-line`, also check the target head the same way;
  - `stampDate` = when the destination path ≠ the source path and `index.periodicDateOf(source)` is non-null → `localIsoDate(new Date(ms))`;
  - `reparent(app, plan)`, then `refreshPaths`;
  - then chain null, query = `prevQuery`, and `pendingSelectAtom` targets `[{key: getKey(child.node)}]`;
  - errors are handled as in `reparentAtom`.
  - The Enter handler in SearchBar picks the target: the selected row's node; else, with no rows and a non-blank `q`, `chain.confirm === q.trim()` → `{nodeType: "newPage", name: q.trim()}`, otherwise set `confirm = q.trim()` (Enter is a no-op when `q.trim()` matches `INVALID_NAME_RE`). Nothing resets `confirm`: the prompt is "armed" only while `confirm === q.trim()`, so editing the query disarms it.
- Prose mode:
  - `EditorState.mode` becomes `"append" | "edit" | "prose"`, with the new fields `prose?: ProseTarget` and `proseConfirmed?: boolean`:

    ```ts
    export type ProseTarget = {kind: "note"; path: string; original: string | null} | {kind: "new"; name: string; link: {path: string; line: number; expectedLine: string}}
    ```

    The buffer lives in `outline`, and `caret` = its length.
  - `EditorRequest` `{kind: "edit"; state}` is renamed to `{kind: "session"; state}` ("a transient Alt-Edit or prose session"). Update its handling in `openQuickAddAtom`, its construction in `openEditAtom`, and the `EditorRequest` objects in `src/__tests__/quick-add-flow.test.ts`. Find them with `grep -n 'kind: "edit"' src` and change only `EditorRequest` objects.
  - The `editorStateAtom` setter routes `mode === "append"` to `appendDraftAtom` and everything else to `editSessionAtom`. In InlineEditor's unmount, `if (mode !== "append")` cancels.
  - `openProseAtom(c: prose-note | prose-new)`:
    - note: resolve the file (`noteName` null → `dailyNotePath(cfg)`, else `getFirstLinkpathDest` or `newNotePath(app, noteName, dailyPath)`); `original` = the file's content or null; `outline = original === null ? text + "\n" : appendContent(original, text)`;
    - new: `readLine` the row line (guard as `under-line`); `name` = the first non-blank line with leading `#`s, list markers and checkbox stripped, `INVALID_NAME_RE` characters removed, spaces collapsed, cut to 60 characters, or `Untitled` when empty;
    - set `chainAtom` null and the query to `chipLabel(anchor)`, then `handOffAtom({kind: "session", state: {...emptySession(), mode: "prose", sourcePath: <note path or row path>, outline, caret: outline.length, prose, proseConfirmed: false}})`.
  - `saveEditorAtom`:
    - before the `try`: a prose note with `original !== null`, `!proseConfirmed` and `outlineChanged(original, outline)` → `commit({proseConfirmed: true, saving: false})` and return;
    - the steps after `"attachments"`:
      - note → step `"prose"`: `writeWholeNote(app, path, original, outline)`;
      - new → step `"note"`: `writeNoteContents(app, name, outline, link.path)`, then step `"link"`: `editLine(app, link.path, link.line, link.expectedLine, <expectedLine with " [[name]]" inserted before a trailing " ^blockid", else appended>)`;
    - the save targets: note → `[{key: \`[[${basename}]]\`}]`; new → `[{path: link.path, line: link.line}, {key: \`[[${name.toLowerCase()}]]\`}]`.
  - `editorHintsFor`: pass `mode`, `proseNewName` (for `kind === "new"`), `proseOutlineChanged` and `proseConfirmed`. `quickAddTitle` gives `Write <basename>` (note) and `New note from <basename>:<line+1>` (new).
  - `InlineEditor`, with `const prose = state.mode === "prose"`:
    - outline Enter, Alt+Enter, Tab and Backspace go to Obsidian (`onEnter` returns false; skip those branches);
    - paste uses the content path (`section === "content" || prose`);
    - attachment embeds are joined with `\n`;
    - `openContent` is a no-op, and a plain link click does nothing (Mod+click still opens);
    - no preview block;
    - a name `<input class="ts-prose-name">` above the field when `prose?.kind === "new"`, written via `updateEditorAtom`;
    - the button reads `Cancel`;
    - the root gets class `ts-editor-prose`;
    - add `state.prose` and `state.proseConfirmed` to `hintDeps`.
  - `editor.css`: `.ts-editor-prose .ts-editor-outline .cm-editor {max-height: 60vh; overflow: auto}`.

### 7. Move To replaced in editing views (`action-panel.ts`, `shortcut-handlers.ts`, `shortcuts.ts`)

- `panelItems`: with `ctx.allowEditing`, skip row actions whose `raycastActionOf(action) === "moveToFolder"`, as the `insert` action is skipped today.
- `useShortcutHandlers`: `moveTo: () => scp.allowEditing ? startReparent() : runRaycastAction(["moveToFolder"])`, where `scp` = `useMolecule(SearchViewScope)` (or the view molecule's flag) and `startReparent = useSetAtom(startReparentAtom)`.
- `SHORTCUTS` `moveTo` description becomes `Move (pages: to folder; in Search: choose new parent)`.
- Keep the `moveToFolder` URI handler, `FolderSuggestModal` and `node-actions.ts`, because Raycast and the CLI `serve` responses still emit that URI.

## Critical files & anchors

- `src/view/react-context/state.tsx`: `SearchModalMolecule.searchResultsComputeAtom` (~L149), `selectedLineAtom` (~L190), `settleSelection` (~L279). These are the chain compute hook and the selection interplay.
- `src/view/editor/EditorMolecule.ts`: `EditorState` (L48), the `editorStateAtom` slot routing (L112), `saveEditorAtom` (L218), `reparentAtom` (L294; the pattern for guards and errors).
- `src/editing/vault-edits.ts`: `ReparentPlan` (L33), `reparent` (~L166), `getOrCreateDailyNote`, `writeNoteContents`, `newNotePath`.
- `packages/core/src/edit/outline-edit.ts`: `LINK_ONLY_RE` (L24), the private `indentUnitOf`/`indentBy`/`outlineEndOf` that the new functions reuse, `cutSubtree`/`pasteUnderLinkBullet` (L288–311).
- `src/view/search/SearchBar.tsx`: `handleKeyDown` (L79), the input (L106).

## Verification

Run from the repo root (`/Users/costache/dev/src/costache/obsidian-tree-search`).

1. Core unit tests. Add them to the existing files: `bun test packages/core/src/__tests__/outline-edit.test.ts packages/core/src/__tests__/task-edit.test.ts packages/core/src/__tests__/indexer.test.ts`.
   - `pasteUnderLine`:
     - `- [ ] buy milk\n- other` with head 0 and block `["- [ ] compare prices"]` → `- [ ] buy milk\n    - [ ] compare prices\n- other`;
     - a tab-indented file uses tabs;
     - a mismatched head throws `StaleLineError`;
     - CRLF is kept.
   - `appendOutline` with root `[[P#H]]` merges under an existing `- [[P#H]]` bullet; `scheduleUnscheduledTasks` schedules a task under `- [[P#H]]`.
   - `outlineChanged`: an edit after the first prose line → false; a changed bullet or frontmatter → true.
   - `stampAppendedLine("- check price", "2026-10-07")` → `- check price [created:: 2026-10-07]`; for `- [ ] x` → `- [ ] x [scheduled:: 2026-10-07]`; for `- [ ] x ^abc` → `- [ ] x [scheduled:: 2026-10-07] ^abc`; a line already holding `2026-01-01` is unchanged.
   - `stampMovedBlock` stamps `[[link]]` and task lines but not prose-only children.
   - Round trip: `parseVaultFile("- [ ] buy milk\n    - check price [created:: 2026-10-07]\n", …)` + `indexSinglePage` → the `check price` node exists, its parent is the task, and its `ageDays` corresponds to 2026-10-07.
2. Plugin unit tests:
   - New `src/__tests__/chain.test.ts`:
     - one `it` per row of both spec tables against `planChainCommit`/`planReparent` (exact `ChainCommit`/`ReparentPlan` objects), using RowRefs built from small inline nodes;
     - `parseChainEntry` for `| a`, `## H`, `[ ] t`, `[[X]]`, a multi-line list and multi-line prose;
     - `isEntryInput("#tag")` false and `isEntryInput("# H")` true;
     - `blockLines` heading-after-bullet error.
   - `src/__tests__/vault-edits.test.ts` (extend `makeFakeApp`; it already has `renameFile`/`processFrontMatter`):
     - `addAlias` (missing / string / array / duplicate throws);
     - `appendUnderLine`;
     - `appendBlockAtOutlineEnd` on a note starting with prose (the block lands before the prose);
     - `writeWholeNote` (stale content throws; null original creates);
     - `reparent` `set-parent` (absent, string, array with oldName, array without → append, reference child creates file);
     - `to-folder` (taken name throws);
     - `to-daily` (same file; cross-file with `stampDate` stamping only indexed lines; cut-guard failure message);
     - `under-line` (same-file shift; self-target refusal).
   - `src/__tests__/action-panel.test.ts`: a page row with a `moveToFolder` action yields no "Move To" item when `allowEditing` and keeps it when not.
   - `src/__tests__/quick-add-flow.test.ts` passes with `kind: "session"`.
3. `bun test` (the full suite) and `bun run build`: both green.
4. Live Obsidian smoke test, per AGENTS.md "Live Obsidian Testing": deploy, confirm `shasum dist/main.js <plugin dir>/main.js`, then attach over CDP. In the Search modal (`tree-search:search-modal`) of the confirmed dev vault:
   1. Type a query matching a page P and select it, then type `>`. The DOM shows `.ts-chain-chip` with P's name, the input is empty, and the rows are P's children.
   2. Type `[ ] chain smoke task`. `.ts-chain-preview.is-selected` reads `Today's daily note, under [[P]]`. Press Enter: today's daily note file contains `- [[P]]` with `    - [ ] chain smoke task [scheduled:: <today>]`, and the new row is flashed under the chip.
   3. Arrow onto that task row, type `>`, then `check smoke`, then Enter. Today's daily note now has `        - check smoke [created:: <today>]` under the task line, and `check smoke` shows as the task's child row (indexed through the stamp).
   4. Backspace twice: the chips pop and the earlier query returns.
   5. Select a test page, type `<`, type another page's name, Enter. The first page's frontmatter `parent` is `[[Other]]`.
   6. `await tab.errors()` is empty.
   7. Revert every written line and frontmatter change by hand at the end.

## Assumptions & contingencies

- Live testing writes notes. Use the example vault built by `bun run docs:vault` (`.docs-vault/`) if Obsidian has it open. Otherwise ask the user which vault and notes may be written before step 4. Never write to a personal vault unasked.
- If `searchIndex(graph, "<q> is:folder", …)` returns no folder roots for R1/R2 (folders don't match `contains`), use `pruneResultTree(searchIndex(graph, "is:folder", …), n => n.nodeType === "folder" && n.path.toLowerCase().includes(q.toLowerCase()))` instead.
- If `lst.text` in the indexer's `shouldSkip` has inline fields stripped (the round-trip test fails), test `CREATED_FIELD_RE` against `lst.rawText` instead.
- If the bunshi molecule state survives the modal close, the chain persists on reopen. That is acceptable, and no reset code is added.
