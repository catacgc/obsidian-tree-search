// Pure task edits (Tasks plugin Dataview format): complete/reopen a task and
// set its scheduled date. Single-line edits take a line and return the new line,
// or null when the line is not a (suitable) task.

import { LIST_ITEM_RE } from "../parser/list-scanner.ts"
import { splitLines } from "../search/organise-sections.ts"
import { StaleLineError, indentWidth, linkOnlyTarget } from "./outline-edit.ts"

const TASK_LINE_RE = /^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\](?=\s|$)(.*)$/
const COMPLETION_RE = /\[completion::[^\]]*\]/
const COMPLETION_WITH_SPACE_RE = /[ \t]*\[completion::[^\]]*\]/g
const SCHEDULED_RE = /(\[scheduled::\s*|\(scheduled::\s*|⏳\s*)\d{4}-\d{2}-\d{2}/
const BLOCK_ID_RE = /\s+\^[A-Za-z0-9-]+$/

/** `rest` (the text after the checkbox) with ` field` appended at its end, before a trailing block id. */
function appendField(rest: string, field: string): string {
  const trimmed = rest.trimEnd()
  const id = BLOCK_ID_RE.exec(trimmed)
  return id ? `${trimmed.slice(0, id.index)} ${field}${id[0]}` : `${trimmed} ${field}`
}

/** Completes (`[x]` + `[completion:: today]`) or reopens (`[ ]`, completion date removed) a task line. */
export function setTaskDone(line: string, done: boolean, today: string): string | null {
  const m = TASK_LINE_RE.exec(line)
  if (!m) return null
  const [, prefix, , rest] = m
  if (!done) return `${prefix}[ ]${rest.replace(COMPLETION_WITH_SPACE_RE, "").trimEnd()}`
  const field = `[completion:: ${today}]`
  return `${prefix}[x]${COMPLETION_RE.test(rest) ? rest.replace(COMPLETION_RE, field).trimEnd() : appendField(rest, field)}`
}

/** Sets an open task's scheduled date: an existing `[scheduled:: d]`, `(scheduled:: d)` or `⏳ d` in place, else a
 *  new `[scheduled:: date]` at the end. */
export function scheduleTask(line: string, date: string): string | null {
  const m = TASK_LINE_RE.exec(line)
  if (!m || m[2] !== " ") return null
  const [, prefix, , rest] = m
  return `${prefix}[ ]${SCHEDULED_RE.test(rest) ? rest.replace(SCHEDULED_RE, `$1${date}`).trimEnd() : appendField(rest, `[scheduled:: ${date}]`)}`
}

/** Each open, non-empty task line of `text` that has no scheduled date (`[scheduled:: d]`, `(scheduled:: d)`,
 *  `⏳ d`) and is not nested under a text line gets `[scheduled:: today]` (scheduleTask). A line counts as nested
 *  when the nearest list line above it with a smaller indent has non-empty text that is not a lone `[[link]]`. */
export function scheduleUnscheduledTasks(text: string, today: string): string {
  const stack: { indent: number; text: boolean }[] = []
  return text.split("\n").map(line => {
    const item = LIST_ITEM_RE.exec(line)
    if (!item) return line
    const indent = indentWidth(line)
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop()
    const nested = stack.length > 0 && stack[stack.length - 1].text
    const body = item[2].replace(/^\[[ xX]\]\s+/, "")
    stack.push({ indent, text: body.trim() !== "" && linkOnlyTarget(body) === null })
    const m = TASK_LINE_RE.exec(line)
    if (nested || !m || m[2] !== " " || !m[3].trim() || SCHEDULED_RE.test(m[3])) return line
    return scheduleTask(line, today) ?? line
  }).join("\n")
}

export type TaskLineEdit = { kind: "done"; done: boolean; today: string } | { kind: "schedule"; date: string }

/** Applies `edit` to the task on line `line` of `content`. Completing (`done: true`) also completes every open task
 *  nested under it: the following lines indented deeper (blank lines skipped) up to the first non-blank line
 *  indented no deeper. Scheduling and reopening touch only that line (subtasks keep their own dates). Throws
 *  StaleLineError, changing nothing, when the line no longer equals `expectedLine` or is not a suitable task.
 *  Keeps the file's EOL. */
export function applyTaskEdit(content: string, line: number, expectedLine: string, edit: TaskLineEdit): string {
  const { lines, eol } = splitLines(content)
  if (lines[line] !== expectedLine) throw new StaleLineError()
  const head = edit.kind === "done" ? setTaskDone(expectedLine, edit.done, edit.today) : scheduleTask(expectedLine, edit.date)
  if (head === null) throw new StaleLineError()
  lines[line] = head
  if (edit.kind === "done" && edit.done) {
    const indent = indentWidth(expectedLine)
    for (let i = line + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue
      if (indentWidth(lines[i]) <= indent) break
      const m = TASK_LINE_RE.exec(lines[i])
      if (m && m[2] === " ") lines[i] = setTaskDone(lines[i], true, edit.today) ?? lines[i]
    }
  }
  return lines.join(eol)
}

export type RescheduleKind = "today" | "tomorrow" | "weekend" | "nextWeek"

/** Local `YYYY-MM-DD` for a reschedule: today, tomorrow, the next Saturday after today, or the next Monday after today. */
export function rescheduleDate(kind: RescheduleKind, today: Date): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const weekday = d.getDay() // 0 = Sunday
  const ahead = kind === "today" ? 0
    : kind === "tomorrow" ? 1
    : kind === "weekend" ? (6 - weekday + 7) % 7 || 7
    : (1 - weekday + 7) % 7 || 7
  d.setDate(d.getDate() + ahead)
  return localIsoDate(d)
}

export function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
