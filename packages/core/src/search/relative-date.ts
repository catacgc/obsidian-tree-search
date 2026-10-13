import type { ParsedNode } from "../graph/types.ts"
import { deadlineDate, isUndated, lineDate } from "../graph/boost.ts"

// The date a text row shows: the date inherited from its earliest open
// subtask's scheduled/due date, else its own `lineDate`. Either one sets the indexer's age
// computation, so it is exactly the date the row shows.
export function textSourceDate(node: ParsedNode): string | null {
  if (node.nodeType !== "text") return null
  return node.inheritedDate ?? lineDate(node.searchKey)
}

/** A task with no scheduled/due date of its own nor one inherited from an open subtask. Its row shows no date: its
 *  other dates (a `[created::]` stamp, its note's) are not when it is due. */
export function isUnscheduledTask(node: ParsedNode): boolean {
  return node.nodeType === "text" && node.isTask && node.inheritedDate === undefined && deadlineDate(node.searchKey) === null
}

/** The date a result row for `node`, aged `ageDays`, shows (formatRelativeDate); null for an unscheduled task. */
export function rowDate(node: ParsedNode, ageDays: number, today: Date = new Date()): { label: string; absolute: string } | null {
  return isUnscheduledTask(node) ? null : formatRelativeDate(ageDays, textSourceDate(node), today)
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Compact relative date for a result row, plus its `YYYY-MM-DD` form for the
 * hover tooltip. Past: `Today`, `1d`–`7d`, `1w`–`3w`, `1m`–`12m` (whole
 * calendar months), then the year (`2025`). Future (negative `ageDays`):
 * `Tomorrow`, the weekday (`Wed`) up to 6 days ahead, `Next Week` for the rest
 * of the next calendar week (Monday to Sunday), `This Month`, the month
 * (`Nov`) within this year, then the year (`2027`). `sourceDate` (the line's
 * own date) is used verbatim as the absolute date; otherwise it is rebuilt
 * from whole-day `ageDays`.
 */
export function formatRelativeDate(
  ageDays: number,
  sourceDate: string | null,
  today: Date = new Date(),
): { label: string; absolute: string } | null {
  if (isUndated(ageDays)) return null
  const day = new Date(today)
  day.setHours(0, 0, 0, 0)
  const rebuilt = new Date(day)
  rebuilt.setDate(rebuilt.getDate() - ageDays)
  const absolute = sourceDate
    ?? `${rebuilt.getFullYear()}-${String(rebuilt.getMonth() + 1).padStart(2, "0")}-${String(rebuilt.getDate()).padStart(2, "0")}`
  const [y, m, d] = absolute.split("-").map(Number)
  const target = new Date(y, m - 1, d)
  if (target > day) return { label: futureLabel(day, target), absolute }
  if (ageDays <= 0) return { label: "Today", absolute }
  if (ageDays <= 7) return { label: `${ageDays}d`, absolute }
  if (ageDays < 28) return { label: `${Math.floor(ageDays / 7)}w`, absolute }
  const months = (day.getFullYear() - y) * 12 + (day.getMonth() + 1 - m) - (day.getDate() < d ? 1 : 0)
  if (months > 12) return { label: String(y), absolute }
  return { label: `${Math.max(1, months)}m`, absolute }
}

/** Label for `target`, a local midnight after `day` (today's local midnight). */
function futureLabel(day: Date, target: Date): string {
  // Round: a span crossing a DST change is 23 or 25 hours per day.
  const ahead = Math.round((target.getTime() - day.getTime()) / DAY_MS)
  if (ahead === 1) return "Tomorrow"
  if (ahead <= 6) return WEEKDAYS[target.getDay()]
  // Days left in this Monday-started week, plus the 7 of next week.
  const toEndOfNextWeek = 6 - (day.getDay() + 6) % 7 + 7
  if (ahead <= toEndOfNextWeek) return "Next Week"
  if (target.getFullYear() !== day.getFullYear()) return String(target.getFullYear())
  if (target.getMonth() === day.getMonth()) return "This Month"
  return MONTHS[target.getMonth()]
}
