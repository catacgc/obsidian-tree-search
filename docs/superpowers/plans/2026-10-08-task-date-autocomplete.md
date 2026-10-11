# `@` Date Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On open task lines, `@today` / `@tomorrow` / `@weekend` / `@later` open a popup at the `@word`; picking one replaces it with `[scheduled:: YYYY-MM-DD]` (spec: `docs/superpowers/specs/2026-10-08-task-date-autocomplete-design.md`).

**Architecture:** One pure core module (`date-suggest.ts`) finds the open `@word` and builds the choices and the edit. The Search bar feeds them through its existing suggestion atoms and `SearchAutocomplete` popup (placed at the `@`); the inline editor uses a small hook and the same popup, placed with CodeMirror's `coordsAtPos`.

**Tech Stack:** TypeScript, React, Jotai/bunshi, CodeMirror 6 (Obsidian's embedded editor), `bun:test`.

---

## Files

- Modify `packages/core/src/edit/task-edit.ts`: `RescheduleKind` += `"later"`.
- Create `packages/core/src/edit/date-suggest.ts`: `dateSuggestAt`, `applyDateSuggestion`, `isDateSuggestion`, `DateSuggestion`.
- Modify `packages/core/src/search/suggest.ts`: `Suggestion.detail?`.
- Modify `packages/core/src/index.ts`: exports.
- Create `packages/core/src/__tests__/date-suggest.test.ts`; modify `packages/core/src/__tests__/task-edit.test.ts`.
- Modify `src/view/search/SearchAutocomplete.tsx`, `src/view/search/ActionPanel.css`: detail column, caret placement.
- Modify `src/view/react-context/state.tsx` (`rawSuggestionsAtom`), `src/view/search/SearchBar.tsx`: chain dates.
- Modify `src/view/editor/MarkdownField.tsx` (`coordsAt`), create `src/view/editor/date-suggest.ts` (`useDateSuggest`), modify `src/view/editor/InlineEditor.tsx`.
- Docs: `EDITOR.md`, `docs/editor.md`.

### Task 1: `later` reschedule kind

**Files:** Modify `packages/core/src/edit/task-edit.ts:124-136`; Test `packages/core/src/__tests__/task-edit.test.ts` (`describe("rescheduleDate")`).

- [ ] **Step 1: failing test** — after the "Next Week" test:

```ts
  it("Later is the Tuesday of next week (the day after Next Week)", () => {
    expect(days.map((_, i) => rescheduleDate("later", on(i)))).toEqual([
      "2026-10-13", "2026-10-13", "2026-10-13", "2026-10-13", "2026-10-13", "2026-10-13", "2026-10-13",
    ])
  })
```

- [ ] **Step 2:** `bun test packages/core/src/__tests__/task-edit.test.ts` → type error / FAIL.
- [ ] **Step 3: implement**

```ts
export type RescheduleKind = "today" | "tomorrow" | "weekend" | "nextWeek" | "later"

/** Local `YYYY-MM-DD` for a reschedule: today, tomorrow, the next Saturday after today, the next Monday after today,
 *  or (later) the Tuesday after that Monday. */
export function rescheduleDate(kind: RescheduleKind, today: Date): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const weekday = d.getDay() // 0 = Sunday
  const nextMonday = (1 - weekday + 7) % 7 || 7
  const ahead = kind === "today" ? 0
    : kind === "tomorrow" ? 1
    : kind === "weekend" ? (6 - weekday + 7) % 7 || 7
    : kind === "later" ? nextMonday + 1
    : nextMonday
  d.setDate(d.getDate() + ahead)
  return localIsoDate(d)
}
```

- [ ] **Step 4:** rerun → PASS.

### Task 2: core `date-suggest.ts`

**Files:** Create `packages/core/src/edit/date-suggest.ts`, `packages/core/src/__tests__/date-suggest.test.ts`; modify `packages/core/src/search/suggest.ts:3`, `packages/core/src/index.ts`.

- [ ] **Step 1: failing tests**

```ts
import { describe, it, expect } from "bun:test"
import { applyDateSuggestion, dateSuggestAt, isDateSuggestion } from "../edit/date-suggest.ts"

const NOW = new Date(2026, 9, 8, 15, 0) // Thu 8 Oct 2026
const at = (text: string, linePrefix = "") => dateSuggestAt(text, text.length, NOW, linePrefix)

describe("dateSuggestAt", () => {
  it("lists every choice for a bare @ on an open task line, with dates", () => {
    expect(at("- [ ] call Bob @").map(s => [s.label, s.detail, s.insertText])).toEqual([
      ["Today", "Thu 8 Oct", "[scheduled:: 2026-10-08]"],
      ["Tomorrow", "Fri 9 Oct", "[scheduled:: 2026-10-09]"],
      ["Weekend", "Sat 10 Oct", "[scheduled:: 2026-10-10]"],
      ["Later", "Tue 13 Oct", "[scheduled:: 2026-10-13]"],
    ])
  })

  it("filters by the typed prefix, case-insensitively, and keeps a complete word", () => {
    expect(at("- [ ] x @T").map(s => s.label)).toEqual(["Today", "Tomorrow"])
    expect(at("- [ ] x @tom").map(s => s.label)).toEqual(["Tomorrow"])
    expect(at("- [ ] x @later").map(s => s.label)).toEqual(["Later"])
    expect(at("- [ ] x @soon")).toEqual([])
  })

  it("gives the @word's range", () => {
    const [s] = at("- [ ] x @we")
    expect([s.start, s.end]).toEqual([8, 11])
  })

  it("needs an open task line: marker optional, any indent; not done tasks or plain lines", () => {
    expect(at("    * [ ] x @t")).not.toEqual([])
    expect(at("[ ] x @t")).not.toEqual([])
    expect(at("- [x] x @t")).toEqual([])
    expect(at("- note @t")).toEqual([])
  })

  it("uses linePrefix for a field holding only the line's text (Alt-Edit)", () => {
    expect(at("call @t", "- [ ] ")).not.toEqual([])
    expect(at("call @t", "- ")).toEqual([])
  })

  it("ignores @ inside a word and a caret before the word's end", () => {
    expect(at("- [ ] mail a@t")).toEqual([])
    expect(dateSuggestAt("- [ ] x @tod", 10, NOW)).toEqual([])
  })

  it("reads the caret's line of a multi-line text", () => {
    const text = "- [[P]]\n    - [ ] x @t\n- y"
    const [s] = dateSuggestAt(text, text.indexOf("\n- y"), NOW)
    expect(text.slice(s.start, s.end)).toBe("@t")
  })

  it("marks its suggestions as date suggestions", () => {
    expect(isDateSuggestion(at("- [ ] x @")[0])).toBe(true)
    expect(isDateSuggestion({ label: "is:task", insertText: "is:task" })).toBe(false)
  })
})

describe("applyDateSuggestion", () => {
  it("replaces the @word and puts the caret after the field", () => {
    const text = "- [ ] call @tom about it"
    const s = dateSuggestAt(text, 15, NOW)[0]
    expect(applyDateSuggestion(text, s)).toEqual({ text: "- [ ] call [scheduled:: 2026-10-09] about it", caret: 35 })
  })

  it("drops other scheduled fields on that line only", () => {
    const text = "- [ ] a [scheduled:: 2026-01-01]\n- [ ] b ⏳ 2026-01-02 @la (scheduled:: 2026-01-03)"
    const s = dateSuggestAt(text, text.indexOf(" (scheduled"), NOW)[0]
    expect(applyDateSuggestion(text, s).text)
      .toBe("- [ ] a [scheduled:: 2026-01-01]\n- [ ] b [scheduled:: 2026-10-13]")
  })
})
```

- [ ] **Step 2:** `bun test packages/core/src/__tests__/date-suggest.test.ts` → FAIL (module missing).
- [ ] **Step 3: implement** `packages/core/src/edit/date-suggest.ts`:

```ts
// `@today` / `@tomorrow` / `@weekend` / `@later` on an open task line: choices for the open `@word` before the caret,
// and the edit that replaces it with the task's `[scheduled:: date]`.

import type { Suggestion } from "../search/suggest.ts"
import { rescheduleDate, type RescheduleKind } from "./task-edit.ts"

/** A scheduled-date choice for the `@word` at text[start, end). */
export type DateSuggestion = Suggestion & { detail: string; start: number; end: number }

const CHOICES: { word: string; label: string; kind: RescheduleKind }[] = [
  { word: "today", label: "Today", kind: "today" },
  { word: "tomorrow", label: "Tomorrow", kind: "tomorrow" },
  { word: "weekend", label: "Weekend", kind: "weekend" },
  { word: "later", label: "Later", kind: "later" },
]

/** An open task line; the list marker is optional (a chain entry `[ ] x`, an unmarked editor line). */
const OPEN_TASK_RE = /^\s*(?:(?:[-*+]|\d+\.)\s+)?\[ \](?=\s|$)/
const AT_WORD_RE = /(?:^|\s)@([A-Za-z]*)$/
const SCHEDULED_FIELD_RE = /[ \t]*(?:\[scheduled::\s*\d{4}-\d{2}-\d{2}\s*\]|\(scheduled::\s*\d{4}-\d{2}-\d{2}\s*\)|⏳\s*\d{4}-\d{2}-\d{2})/g
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function lineBounds(text: string, pos: number): { start: number; end: number } {
  const nl = text.indexOf("\n", pos)
  return { start: text.lastIndexOf("\n", pos - 1) + 1, end: nl === -1 ? text.length : nl }
}

/** `Thu 8 Oct` for a `YYYY-MM-DD`. */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  return `${DAYS[new Date(y, m - 1, d).getDay()]} ${d} ${MONTHS[m - 1]}`
}

/** The choices for the `@word` ending at `caret` (`@` at the line start or after whitespace, then letters), when the
 *  caret's line is an open task (`linePrefix` + the line: a field holding only the line's text passes its prefix).
 *  Filtered by the typed prefix; `@` alone lists all. Empty when none applies. */
export function dateSuggestAt(text: string, caret: number, now: Date, linePrefix = ""): DateSuggestion[] {
  const line = lineBounds(text, caret)
  if (/[A-Za-z]/.test(text[caret] ?? "")) return []
  if (!OPEN_TASK_RE.test(linePrefix + text.slice(line.start, line.end))) return []
  const m = AT_WORD_RE.exec(text.slice(line.start, caret))
  if (!m) return []
  const typed = m[1].toLowerCase()
  const start = caret - m[1].length - 1
  return CHOICES.filter(c => c.word.startsWith(typed)).map(c => {
    const date = rescheduleDate(c.kind, now)
    return { label: c.label, detail: dayLabel(date), insertText: `[scheduled:: ${date}]`, start, end: caret }
  })
}

/** `text` with the suggestion's `@word` replaced by its field and any other scheduled field on that line removed (so
 *  the task keeps one); the caret goes after the field. */
export function applyDateSuggestion(text: string, s: DateSuggestion): { text: string; caret: number } {
  const line = lineBounds(text, s.start)
  const before = text.slice(line.start, s.start).replace(SCHEDULED_FIELD_RE, "")
  const after = text.slice(s.end, line.end).replace(SCHEDULED_FIELD_RE, "")
  return {
    text: text.slice(0, line.start) + before + s.insertText + after + text.slice(line.end),
    caret: line.start + before.length + s.insertText.length,
  }
}

export function isDateSuggestion(s: Suggestion): s is DateSuggestion {
  return "start" in s
}
```

`packages/core/src/search/suggest.ts:3`:

```ts
/** `detail`: secondary text shown after the label (e.g. a date). */
export type Suggestion = { label: string; insertText: string; detail?: string }
```

`packages/core/src/index.ts`, after the `./edit/task-edit.ts` block:

```ts
export { dateSuggestAt, applyDateSuggestion, isDateSuggestion, type DateSuggestion } from "./edit/date-suggest.ts"
```

- [ ] **Step 4:** rerun → PASS. Commit with Task 1: `git commit -m "Core: @ date suggestions for task lines"`.

### Task 3: popup detail + caret placement

**Files:** `src/view/search/SearchAutocomplete.tsx`, `src/view/search/ActionPanel.css:216-236`.

- [ ] **Step 1:** `SearchAutocomplete`:

```tsx
export type SearchAutocompleteProps = {
    suggestions: Suggestion[]
    highlightedIndex: number
    onHover: (index: number) => void
    onAccept: (suggestion: Suggestion) => void
    /** Open at this point (px, in the positioned parent), e.g. under an `@word`; omitted: full width under the input. */
    at?: {left: number; top?: number}
}

export const SearchAutocomplete = ({ suggestions, highlightedIndex, onHover, onAccept, at }: SearchAutocompleteProps) => {
    if (suggestions.length === 0) return null

    // Styled as the ⌘K action panel, like the editor's [[ link list: shared `.ts-suggest` surface and item rows (ActionPanel.css).
    return (
        <div className={`ts-suggest${at ? " is-at-caret" : ""}`} style={at} role="listbox">
            {suggestions.map((s, i) => (
                <div
                    key={s.label}
                    role="option"
                    aria-selected={i === highlightedIndex}
                    className={`ts-action-panel-item ${i === highlightedIndex ? "is-selected" : ""}`}
                    onMouseEnter={() => onHover(i)}
                    onMouseDown={ev => { ev.preventDefault(); onAccept(s) }}
                >
                    <span className="ts-action-panel-label">{s.label}</span>
                    {s.detail && <span className="ts-suggest-detail">{s.detail}</span>}
                </div>
            ))}
        </div>
    )
}
```

- [ ] **Step 2:** CSS after `.is-phone .ts-suggest .ts-action-panel-item`:

```css
/* Opened under a typed `@word` (date choices) instead of across the input. */
.ts-suggest.is-at-caret {
	right: auto;
	width: max-content;
	min-width: 180px;
}

.ts-suggest-detail {
	flex-shrink: 0;
	color: var(--text-muted);
}
```

### Task 4: Search chain

**Files:** `src/view/react-context/state.tsx:578-582`, `src/view/search/SearchBar.tsx`.

- [ ] **Step 1:** `rawSuggestionsAtom` (add `dateSuggestAt` to the `@mdtree/core` import on line 2):

```ts
    const rawSuggestionsAtom = atom<Suggestion[]>((get) => {
        const query = get(actualQueryAtom)
        const cursorPos = get(cursorPosAtom)
        // An append chain's task entry (`[ ] call Bob @tom`) offers scheduled dates instead of query syntax.
        const dates = get(chainAtom)?.mode === "append" ? dateSuggestAt(query, cursorPos, new Date()) : []
        return dates.length > 0 ? dates : suggestAt(query, cursorPos)
    })
```

- [ ] **Step 2:** `SearchBar.tsx`: import `applyDateSuggestion, isDateSuggestion` from `@mdtree/core`. Add a module-level helper:

```ts
/** Left edge (px, in the input's offset parent) of the character at `pos`: the input's text width before it, in its font. */
function caretLeft(input: HTMLInputElement, pos: number): number {
    const style = getComputedStyle(input)
    const ctx = document.createElement("canvas").getContext("2d")
    const width = ctx ? (ctx.font = style.font, ctx.measureText(input.value.slice(0, pos)).width) : 0
    return input.offsetLeft + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft) + width - input.scrollLeft
}
```

Replace `acceptSuggestion`:

```ts
    const acceptSuggestion = (suggestion: Suggestion) => {
        if (isDateSuggestion(suggestion)) {
            const edit = applyDateSuggestion(searchQuery.query, suggestion)
            pendingSelection.current = {start: edit.caret, end: edit.caret}
            setSearch(edit.text)
            setCursorPos(edit.caret)
        } else {
            const spliced = spliceSuggestion(searchQuery.query, cursorPos, suggestion.insertText)
            setSearch(spliced.query)
            setCursorPos(spliced.cursorPos)
        }
        resetSuggestions()
    }
```

In `handleSuggestionKey`, before the `Tab` branch:

```ts
        } else if (ev.key === "Enter" && !ev.altKey && !ev.shiftKey && isDateSuggestion(suggestions[suggestionIndex])) {
            acceptSuggestion(suggestions[suggestionIndex])
```

Escape (Scope) closes open suggestions before leaving the chain:

```ts
    escapeRef.current = () => suggestions.length > 0 ? dismissSuggestions() : cancelChain()
```

Render: before `return <>`:

```ts
    const dateAt = suggestions.length > 0 && isDateSuggestion(suggestions[0]) && inputRef.current
        ? {left: caretLeft(inputRef.current, suggestions[0].start)} : undefined
```

and pass `at={dateAt}` to `<SearchAutocomplete …/>`.

- [ ] **Step 3:** `bun run build` → no type errors.

### Task 5: inline editor

**Files:** `src/view/editor/MarkdownField.tsx:13-20,139-146`, create `src/view/editor/date-suggest.ts`, `src/view/editor/InlineEditor.tsx`.

- [ ] **Step 1:** `MarkdownFieldHandle` += 

```ts
    /** Viewport coordinates of the character at `pos` (CodeMirror coordsAtPos), null while not drawn. */
    coordsAt(pos: number): { left: number; bottom: number } | null
```

and in the handle: `coordsAt: pos => cm.coordsAtPos(clamp(pos)),`.

- [ ] **Step 2:** `src/view/editor/date-suggest.ts`:

```ts
// The inline editor's `@` scheduled-date popup state (dateSuggestAt on the focused outline field).
import {useEffect, useState} from "react";
import {dateSuggestAt, type DateSuggestion} from "@mdtree/core";

export type DateSuggestState = {
    /** Empty while closed. */
    items: DateSuggestion[]
    index: number
    setIndex(index: number): void
    move(delta: 1 | -1): void
    /** Hides the popup until this `@word` is closed. */
    dismiss(): void
}

export function useDateSuggest(text: string, caret: number, active: boolean, linePrefix: string): DateSuggestState {
    const [dismissedStart, setDismissedStart] = useState<number | null>(null)
    const [index, setIndex] = useState(0)
    const all = active ? dateSuggestAt(text, caret, new Date(), linePrefix) : []
    const start = all[0]?.start ?? -1
    const items = start === dismissedStart ? [] : all
    const labels = items.map(s => s.label).join()

    useEffect(() => { if (start < 0) setDismissedStart(null) }, [start])
    useEffect(() => setIndex(0), [labels, start])

    const i = Math.min(index, Math.max(0, items.length - 1))
    return {
        items,
        index: i,
        setIndex,
        move: delta => setIndex((i + delta + items.length) % items.length),
        dismiss: () => setDismissedStart(start),
    }
}
```

- [ ] **Step 3:** `InlineEditor.tsx`:
  - imports: `applyDateSuggestion, type DateSuggestion` from `@mdtree/core`; `useDateSuggest` from `./date-suggest`; `SearchAutocomplete` from `../search/SearchAutocomplete`.
  - after `contentSuggest`: `const dateSuggest = useDateSuggest(state.outline, state.caret, focused === "outline", state.linePrefix ?? "")` and `const outlineFieldRef = useRef<HTMLDivElement>(null)`.
  - `escapeRef.current`: first line `if (dateSuggest.items.length > 0) return dateSuggest.dismiss()`.
  - next to `accept`:

```ts
    /** A picked `@` date: replaces the `@word` with the task's `[scheduled:: date]`. */
    function acceptDate(s: DateSuggestion) {
        const h = outlineRef.current
        if (h) applyEdit("outline", applyDateSuggestion(h.text(), s))
    }
```

  - in `onKeyDown`, right after `const sug = suggestFor(section)`:

```ts
        if (section === "outline" && dateSuggest.items.length > 0 && !ev.altKey && !mod) {
            if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
                dateSuggest.move(ev.key === "ArrowDown" ? 1 : -1)
                return true
            }
            if ((ev.key === "Enter" || ev.key === "Tab") && !ev.shiftKey) {
                acceptDate(dateSuggest.items[dateSuggest.index])
                return true
            }
        }
```

  - render: the outline `.ts-editor-field` div gets `ref={outlineFieldRef}`; after its `<MarkdownField …/>`:

```tsx
            {dateSuggest.items.length > 0 && <SearchAutocomplete
                suggestions={dateSuggest.items}
                highlightedIndex={dateSuggest.index}
                onHover={dateSuggest.setIndex}
                onAccept={s => acceptDate(s as DateSuggestion)}
                at={popupAt(outlineRef.current, outlineFieldRef.current, dateSuggest.items[0].start)}
            />}
```

  with a module-level helper:

```ts
/** Where the `@` popup opens in the field box: under the character at `pos`. */
function popupAt(h: MarkdownFieldHandle | null, box: HTMLElement | null, pos: number): {left: number; top: number} | undefined {
    const c = h?.coordsAt(pos)
    if (!c || !box) return undefined
    const r = box.getBoundingClientRect()
    return {left: c.left - r.left, top: c.bottom - r.top}
}
```

- [ ] **Step 4:** `bun test` and `bun run build` → all pass, no type errors. Commit: `git commit -m "@ date popup in the editor and search chain"`.

### Task 6: docs + live check

- [ ] **Step 1:** `EDITOR.md` §3 (editor behaviour list near "Dates on save"): add a bullet

  `- **@ dates:** on an open task line (Alt-Edit: by its linePrefix) in the outline field or an append chain's task entry, `@` + letters opens a popup at the `@word` (dateSuggestAt): Today, Tomorrow, Weekend (next Saturday), Later (Tuesday of next week), each with its date. ↑/↓ move, Enter/Tab replace the word with `[scheduled:: date]` and drop any other scheduled field on that line (applyDateSuggestion); Escape closes only the popup.`

  `docs/editor.md` "More editing" list: `- **Scheduling.** On a task line, type `@today`, `@tomorrow`, `@weekend` or `@later` (Tuesday next week) and press Enter to add its scheduled date. Works in the search box's `>` chain too.`
- [ ] **Step 2:** live check per AGENTS.md (Docs vault): Quick Add `- [ ] call @tom` → popup at `@`, Enter → `- [ ] call [scheduled:: <tomorrow>]`; `@` + Escape → popup closes, editor stays; Search modal `>` on blank, type `[ ] x @la` → popup under `@`, Enter → input `[ ] x [scheduled:: <next Tue>]`, preview shows it, Enter writes it; `tab.errors()` empty; restore the vault.
