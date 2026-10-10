import type { ParsedNode } from "../graph/types.ts"
import { isUndated } from "../graph/boost.ts"

// The first `YYYY-MM-DD` in a text line's own text. It takes precedence in the
// indexer's age computation, so it is exactly the date the row shows.
export function textSourceDate(node: ParsedNode): string | null {
  if (node.nodeType !== "text") return null
  return /\d{4}-\d{2}-\d{2}/.exec(node.searchKey)?.[0] ?? null
}

/**
 * Compact relative date for a result row, plus its `YYYY-MM-DD` form for the
 * hover tooltip: `Today`, `1d`–`7d`, `1w`–`3w`, `1m`–`12m` (whole calendar
 * months), then the year (`2025`). `sourceDate` (the line's own date) is used
 * verbatim as the absolute date; otherwise it is rebuilt from whole-day
 * `ageDays`, which may be off by one near midnight across timezones. The index
 * clamps future dates to age 0, so those show their absolute date instead.
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
  if (new Date(y, m - 1, d) > day) return { label: absolute, absolute }
  if (ageDays === 0) return { label: "Today", absolute }
  if (ageDays <= 7) return { label: `${ageDays}d`, absolute }
  if (ageDays < 28) return { label: `${Math.floor(ageDays / 7)}w`, absolute }
  const months = (day.getFullYear() - y) * 12 + (day.getMonth() + 1 - m) - (day.getDate() < d ? 1 : 0)
  if (months > 12) return { label: String(y), absolute }
  return { label: `${Math.max(1, months)}m`, absolute }
}
