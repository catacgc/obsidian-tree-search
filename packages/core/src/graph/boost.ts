import type { ParsedNode } from "./types.ts"

const BOOST: Record<ParsedNode["nodeType"], number> = {
  page: 6,
  folder: 5,
  folderNote: 5,
  header: 4,
  attachment: 3,
  month: 2,
  pointer: 1,
  text: 1,
}

const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u

export function containsEmoji(text: string): boolean {
  return emojiRegex.test(text)
}

// Sentinel age for nodes that carry no explicit, semantic date. Filesystem
// ctime/mtime are deliberately ignored, so an "undated" node is treated as
// infinitely old: it never satisfies an `in:<window>` recency filter and sorts
// below every dated node. A large finite value (not Infinity) keeps it safe to
// persist (SQLite) and serialize (JSON).
export const UNDATED_AGE = Number.MAX_SAFE_INTEGER

export function isUndated(ageDays: number): boolean {
  return ageDays >= UNDATED_AGE
}

// A `YYYY-MM-DD` is a calendar day in the user's time zone: local midnight,
// not `new Date(iso)`'s UTC midnight.
function extractDateFromString(s: string): Date | null {
  const match = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null
}

// Whole local calendar days from the timestamp's day to today: 0 today, 1
// yesterday, negative for future days (-1 tomorrow).
function calculateAgeDays(timestamp: number | Date): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // Round: a span crossing a DST change is 23 or 25 hours per day.
  return Math.round((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
}

// Age in whole days for a `YYYY-MM-DD` embedded in `text` (a node's own line or
// a filename), or null when none is present. Used both as the top-precedence
// date source and to let a dated child override an inherited page age.
export function ageDaysFromText(text?: string): number | null {
  if (!text) return null
  const date = extractDateFromString(text)
  return date ? calculateAgeDays(date) : null
}

// Resolve a node's age (in whole days) from explicit dates only. Precedence:
//   1. a `YYYY-MM-DD` in `dateStr` (node text / filename)
//   2. `explicitDateMs` — a page-level date (frontmatter `updated`/`created`, or
//      a parsed daily/weekly-note date), in ms epoch
//   3. otherwise UNDATED_AGE
export function getAgeDays(dateStr?: string, explicitDateMs?: number | null): number {
  const fromText = ageDaysFromText(dateStr)
  if (fromText !== null) return fromText
  if (explicitDateMs !== undefined && explicitDateMs !== null) {
    return calculateAgeDays(explicitDateMs)
  }
  return UNDATED_AGE
}

const TYPE_STEP = 10000

export function calculateBoost(
  nodeType: ParsedNode["nodeType"],
  searchKey: string,
  ageDays = 0,
): number {
  // Clamp so undated nodes (ageDays = UNDATED_AGE) contribute 0 rather than a
  // huge negative that would swamp the type boost, so very old dated nodes
  // never underflow, and so future dates (negative ages) rank like today.
  // Range: 0 (>=1000 days / undated) .. 1000 (today or later).
  const ageBoost = 1000 - Math.min(Math.max(ageDays, 0), 1000)
  const typeBoost = (10 + BOOST[nodeType]) * TYPE_STEP
  const emojiBoost = containsEmoji(searchKey) ? 1000 : 0
  return ageBoost + typeBoost + emojiBoost
}

/** The node-type tier of a `calculateBoost` value: age and emoji (≤ 2000) never cross a tier. */
export function boostTier(boost: number): number {
  return Math.floor(boost / TYPE_STEP)
}
