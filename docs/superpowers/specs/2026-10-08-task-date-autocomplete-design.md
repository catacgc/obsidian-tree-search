# `@` date autocomplete on task lines

## Goal

While typing an open task line, `@today`, `@tomorrow`, `@weekend` and `@later` offer a popup at the caret. Picking one replaces the `@word` with the task's scheduled field, e.g. `- [ ] call Bob @tom` → `- [ ] call Bob [scheduled:: 2026-10-09]`.

## Surfaces

- **Inline editor** (Append, Quick Add, Alt-Edit): the CodeMirror outline field. A line counts as an open task when it is `- [ ] …` (any list marker, any indent). In Alt-Edit the field holds only the line's text; its `linePrefix` (`- [ ] `) decides.
- **Search chain input** (`>` append chain, not `<` Move to): the typed entry counts as an open task when it starts with `[ ] ` or `- [ ] ` (`parseChainEntry`'s rule).
- Not in content sections, plain Search queries, Quick Link or regular notes.

## Choices

|Keyword|Date|Thu 8 Oct 2026|
|---|---|---|
|`today`|today|Thu 8 Oct|
|`tomorrow`|today + 1|Fri 9 Oct|
|`weekend`|`rescheduleDate("weekend")`: the next Saturday after today|Sat 10 Oct|
|`later`|Tuesday of next week: `rescheduleDate("nextWeek")` (the next Monday after today) + 1 day|Tue 13 Oct|

`later` on Mon 5 Oct is Tue 13 Oct, never tomorrow. It is added to core as `RescheduleKind` `"later"`; the Task panel keeps its current four items.

## Trigger and filtering

- An open `@word` ends at the caret: `@` at the start of the text or after whitespace, followed by zero or more letters (`/(^|\s)@([a-z]*)$/i` on the text before the caret, same line).
- Shown: the keywords that start with `word` (case-insensitive), in table order. `@` alone shows all four. No match → no popup. A complete keyword (`@today`) still shows its row, so Enter expands it.
- Each row shows the label (`Today`) and the date (`Thu 8 Oct`), dates computed when the popup renders (`localIsoDate(new Date())`).

## Accepting

- **Keys:** ↑/↓ move, Enter or Tab expands the highlighted row, Escape closes the popup (it does not close the editor or leave the chain). Click expands too. Moving the caret off the `@word` or typing a non-letter closes it.
- **Edit:** `@word` is replaced by `[scheduled:: YYYY-MM-DD]`; the caret goes after it. Any other scheduled field already on that line (`[scheduled:: d]`, `(scheduled:: d)`, `⏳ d`) is removed with its leading space, so the line keeps exactly one.
- While the popup is open, Enter does not write the chain or insert a newline in the editor.
- Save stamping (`stampAppendedLine`) leaves the line alone because it already holds a date.

## Components

- **Core** (`packages/core/src/edit/task-edit.ts`, exported from `index.ts`):
  - `RescheduleKind` += `"later"`; `rescheduleDate("later", now)`.
  - `dateSuggestAt(text, caret, isTask, now): DateSuggestion[]`: the open `@word` on the caret's line, or `[]`. `DateSuggestion = {label, detail, insertText, start, end}` (the `@word` range).
  - `applyDateSuggestion(text, s): {text, caret}`: replaces `start..end`, removes other scheduled fields on that line.
- **Popup:** `SearchAutocomplete` (`.ts-suggest`) gains an optional `detail` column and an optional caret position (`left`/`top` style). The search bar keeps its `is:`/`has:`/`in:` suggestions under the input; date suggestions are placed at the caret.
- **Search chain:** `SearchBar` computes date suggestions when the chain is in append mode and the input is a task entry; they share the popup, index and keys with the query suggestions (query suggestions never apply to entries). Enter accepts a date suggestion. The caret x comes from measuring the input text before the caret (canvas `measureText` with the input's computed font) minus `scrollLeft`.
- **Inline editor:** `InlineEditor` computes date suggestions for the focused outline field from `state.outline`/`state.caret` (Alt-Edit: `linePrefix`), renders the popup at `cm.coordsAtPos(caret)` relative to the editor, and handles its keys in the field's `onKeyDown` ahead of the `[[` result keys.

## Testing

- Core unit tests: `rescheduleDate("later")` across the week (Mon → next week's Tue, Sun → Tue 2 days later, Thu → next Tue); `dateSuggestAt` prefix filtering, `@` alone, `@` inside a word (`a@b`) ignored, non-task line ignored, caret not at the word's end ignored, second line of a multi-line text; `applyDateSuggestion` replacing the word and dropping an existing `[scheduled:: …]` / `⏳ …` on the same line only.
- Live check (AGENTS.md): Quick Add `- [ ] call @tom` + Enter → `[scheduled:: tomorrow]`; Escape closes only the popup; chain `>` then `[ ] x @la` + Enter → preview and written line have next week's Tuesday.
