// Pure single-line task edits (Tasks plugin Dataview format): complete/reopen
// a task and set its scheduled date. A line in, the new line out; null when
// the line is not a (suitable) task.

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

export type RescheduleKind = "tomorrow" | "weekend" | "nextWeek"

/** Local `YYYY-MM-DD` for a reschedule: tomorrow, the next Saturday after today, or the next Monday after today. */
export function rescheduleDate(kind: RescheduleKind, today: Date): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const weekday = d.getDay() // 0 = Sunday
  const ahead = kind === "tomorrow" ? 1
    : kind === "weekend" ? (6 - weekday + 7) % 7 || 7
    : (1 - weekday + 7) % 7 || 7
  d.setDate(d.getDate() + ahead)
  return localIsoDate(d)
}

export function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
