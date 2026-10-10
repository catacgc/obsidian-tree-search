# Task actions: checkbox, Done/reschedule menu, task ordering

Date: 2026-10-06

## Goal

Task rows (`text` nodes with `isTask`) in Search results:

1. show a clickable checkbox in **Tree and Timeline** rows; clicking it completes or reopens the task in its note;
2. get a **Task** section in the action panel with **Done**, **Tomorrow**, **Weekend**, **Next Week**;
3. sort **open tasks first, oldest first** (overdue → today → upcoming → future), in Timeline and Tree.

## Line format

The Tasks plugin is in Dataview format in the target vault (`[scheduled:: YYYY-MM-DD]`, `[completion:: YYYY-MM-DD]` on 182 of 304 done tasks). Edits only touch one list line, keep its indent, marker and text, and preserve the file's line endings.

- **Complete:** `[ ]` → `[x]`, and append ` [completion:: <today>]` (replacing an existing `[completion:: …]`).
- **Reopen** (checkbox on a done task): `[x]`/`[X]` → `[ ]`, and remove `[completion:: …]` (with its leading space).
- **Reschedule:** replace the date of an existing `[scheduled:: d]`, `(scheduled:: d)` or `⏳ d` in place; otherwise append ` [scheduled:: <date>]`.
- Appended fields go at the end of the line, before a trailing block id (` ^abc-1`) when there is one; trailing whitespace is dropped.
- Recurring tasks (`🔁`, `[repeat:: …]`) get no next occurrence; the target vault has none.

Dates are local calendar days, `today` = the local date when the action runs:

| Action | Date |
|---|---|
| Tomorrow | today + 1 |
| Weekend | the next Saturday after today (Fri → tomorrow; Sat → in 7 days; Sun → in 6 days) |
| Next Week | the next Monday after today (Sun → tomorrow; Mon → in 7 days) |

The row's displayed date is the line's first `YYYY-MM-DD` (existing indexer rule), so a task with no other date shows its scheduled/completion date (e.g. **Tomorrow**, **Sat**, **Next Week**).

## Components

**Core (pure, `packages/core/src/edit/task-edit.ts`, exported from `index.ts`):**

```ts
export function setTaskDone(line: string, done: boolean, today: string): string | null // null: not a task line
export function scheduleTask(line: string, date: string): string | null              // null: not an open task line
export type RescheduleKind = "tomorrow" | "weekend" | "nextWeek"
export function rescheduleDate(kind: RescheduleKind, today: Date): string            // local YYYY-MM-DD
```

**Plugin write path** (same safety as Alt-Edit): a `taskEditAtom` in `EditorMolecule` takes the row and a change (`{kind: "done", done}` or `{kind: "schedule", when}`):

1. `readLine` the row's `location` line; it must be a list line that is a task and pass `lineHasIdentity` — else the existing "This row's index is out of date" Notice + refresh.
2. Compute the new line with the core function; `editLine(app, path, line, expected = read line, newLine)` (`StaleLineError` → same Notice).
3. `refreshPaths` that file, keeping the row selected (`pendingSelectAtom`) when it is still in the results.

**Checkbox:** one `TaskCheckbox` component used by `SearchTreeNode` (replaces the read-only box in `BulletOrTask`) and `TimelineRow` (first child of `.ts-timeline-row`). Controlled by `isCompleted`; a click stops propagation (no select/open/expand, no drag start: `draggable={false}`, `onDragStart` prevented) and runs `taskEditAtom(row, {kind: "done", done: !isCompleted})`. Rows in pick mode (Quick Add's link list, Quick Link) keep a non-interactive box.

**Action panel:** new `PanelSection` `"task"` titled **Task**, listed after the row actions, only for an **open** task row: Done, Tomorrow, Weekend, Next Week (no shortcuts; the panel's filter finds them by title). New `PanelRun` kind `{kind: "task", change}` handled in `ActionPanel.runItem`. Offered in every view that has the action panel, like Archive (not gated on editor mode).

## Ordering

`isOpenTask(node)` = `text` node with `isTask && !isCompleted`.

- **Timeline** (`buildTimeline`): pinned first (unchanged); then open tasks, **oldest first** (larger `ageDays` first, so future tasks — negative ages — come last), ties by boost; then all other rows as today (newest first, ties by boost). Timeline ages already fall back to the file's creation date for undated rows.
- **Tree** (`flatten`): siblings stay grouped by node type (page, folder, header, … as their type boost ranks them). Within the text/pointer tier, open tasks come first, oldest first, **undated open tasks after dated ones**; the other lines follow in the current boost order.

## Docs

`docs/searching.md` (checkbox, Task actions, ordering) and `EDITOR.md` (new vault write: task line edits use the Alt-Edit freshness check).

## Testing

- Core unit tests: `setTaskDone` (complete/reopen, existing completion replaced/removed, block id, CRLF untouched since it is per line, non-task → null), `scheduleTask` (each existing field form replaced, append, block id, done task → null), `rescheduleDate` for every weekday.
- `buildTimeline` and `flattenTree` ordering: overdue/today/future open tasks vs. done tasks and plain lines; undated tasks in Tree.
- `panelItems`: Task section only for open task rows.
- Applier test (`vault-edits.test.ts` fake vault): the write path rewrites the line; a changed line raises `StaleLineError` and leaves the file unchanged.
- Live Obsidian check: click a checkbox in Tree and Timeline (line written, row updates, no navigation), run each Task panel action on a scratch task, observe ordering with `is:task`.
