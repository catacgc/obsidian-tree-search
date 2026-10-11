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
  if (/[A-Za-z]/.test(text[caret] ?? "")) return []
  const line = lineBounds(text, caret)
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
