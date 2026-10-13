// Pure task edits (Tasks plugin Dataview format): complete/reopen a task and
// set its scheduled date. Single-line edits take a line and return the new line,
// or null when the line is not a (suitable) task.

import { ageDaysFromText } from "../graph/boost.ts"
import { LIST_ITEM_RE, isProseText } from "../parser/list-scanner.ts"
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

/** True when `text` holds a scheduled date: `[scheduled:: d]`, `(scheduled:: d)` or `⏳ d`. */
export function hasScheduledDate(text: string): boolean {
  return SCHEDULED_RE.test(text)
}

const SCHEDULED_WITH_SPACE_RE = /[ \t]*(?:\[scheduled::\s*\d{4}-\d{2}-\d{2}\s*\]|\(scheduled::\s*\d{4}-\d{2}-\d{2}\s*\)|⏳\s*\d{4}-\d{2}-\d{2})/g

/** Removes every scheduled date (`[scheduled:: d]`, `(scheduled:: d)`, `⏳ d`) from an open task line; null when the
 *  line is not an open task or has none. */
export function unscheduleTask(line: string): string | null {
  const m = TASK_LINE_RE.exec(line)
  if (!m || m[2] !== " " || !SCHEDULED_RE.test(m[3])) return null
  const [, prefix, , rest] = m
  return `${prefix}[ ]${rest.replace(SCHEDULED_WITH_SPACE_RE, "").trimEnd()}`
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

const ISO_DATE_RE = /\d{4}-\d{2}-\d{2}/

/** A list line without any `YYYY-MM-DD` gets ` [created:: date]` (before a trailing block id); null otherwise. */
export function addCreatedField(line: string, date: string): string | null {
  const m = LIST_ITEM_RE.exec(line)
  if (!m || ISO_DATE_RE.test(line)) return null
  const prefix = line.slice(0, line.length - m[2].length)
  return prefix + appendField(m[2], `[created:: ${date}]`)
}

/** A line appended in a note: an undated open task gets `[scheduled:: today]`, any other undated list line `[created:: today]`. */
export function stampAppendedLine(line: string, today: string): string {
  if (ISO_DATE_RE.test(line)) return line
  const task = TASK_LINE_RE.exec(line)
  if (task && task[2] === " ") return scheduleTask(line, today) ?? line
  return addCreatedField(line, today) ?? line
}

/** Lines appended to a note: each list line is stamped by stampAppendedLine, except bullets that are only a
 *  link (`[[X]]`, `[[X#H]]`, `[[X|A]]`). Those stay bare so they still merge with the note's existing `[[X]]`
 *  bullet and are indexed as the linked note. */
export function stampNewOutlineLines(lines: string[], today: string): string[] {
  return lines.map(l => {
    const item = LIST_ITEM_RE.exec(l)
    return item && linkOnlyTarget(item[2]) !== null ? l : stampAppendedLine(l, today)
  })
}

/** Lines of a moved block that are indexed (tasks, or text with links/tags/URLs) and undated get `[created:: date]`.
 *  Bullets that are only a link (`[[X]]`, `[[X#H]]`, `[[X|A]]`) stay bare: they are indexed as the linked note. */
export function stampMovedBlock(block: string[], date: string): string[] {
  return block.map(l => {
    const item = LIST_ITEM_RE.exec(l)
    if (!item || linkOnlyTarget(item[2]) !== null) return l
    return TASK_LINE_RE.test(l) || !isProseText(item[2]) ? addCreatedField(l, date) ?? l : l
  })
}

export type TaskLineEdit = { kind: "done"; done: boolean; today: string } | { kind: "schedule"; date: string } | { kind: "unschedule" }

/** Applies `edit` to the task on line `line` of `content`. Completing (`done: true`) and unscheduling also apply to
 *  every open task nested under it: the following lines indented deeper (blank lines skipped) up to the first
 *  non-blank line indented no deeper. Unscheduling an open task with no scheduled date of its own only clears its
 *  subtasks. Scheduling and reopening touch only that line (subtasks keep their own dates). Throws StaleLineError,
 *  changing nothing, when the line no longer equals `expectedLine` or is not a suitable task. Keeps the file's EOL. */
export function applyTaskEdit(content: string, line: number, expectedLine: string, edit: TaskLineEdit): string {
  const { lines, eol } = splitLines(content)
  if (lines[line] !== expectedLine) throw new StaleLineError()
  const head = edit.kind === "done" ? setTaskDone(expectedLine, edit.done, edit.today)
    : edit.kind === "schedule" ? scheduleTask(expectedLine, edit.date)
    : isOpenTask(expectedLine) ? unscheduleTask(expectedLine) ?? expectedLine : null
  if (head === null) throw new StaleLineError()
  lines[line] = head
  const nested = edit.kind === "done" && edit.done ? (l: string) => setTaskDone(l, true, edit.today)
    : edit.kind === "unschedule" ? unscheduleTask
    : null
  if (nested) {
    const indent = indentWidth(expectedLine)
    for (let i = line + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue
      if (indentWidth(lines[i]) <= indent) break
      if (isOpenTask(lines[i])) lines[i] = nested(lines[i]) ?? lines[i]
    }
  }
  return lines.join(eol)
}

function isOpenTask(line: string): boolean {
  return TASK_LINE_RE.exec(line)?.[2] === " "
}

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

export function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** The day (YYYY-MM-DD) a note's undated lines are dated by. Uses indexSinglePage's page-date order: a valid
 *  `YYYY-MM-DD` in `fileName`, else `explicitDateMs` (frontmatter `updated`/`created`, else the daily/weekly-note
 *  date) as a local day. Null when the note has no date. */
export function pageDateIso(fileName: string, explicitDateMs: number | null): string | null {
  const named = ISO_DATE_RE.exec(fileName)
  if (named && ageDaysFromText(named[0]) !== null) return named[0]
  return explicitDateMs === null ? null : localIsoDate(new Date(explicitDateMs))
}
