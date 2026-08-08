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

function extractDateFromString(s: string): Date | null {
  const match = s.match(/(\d{4}-\d{2}-\d{2})/)
  if (!match) return null
  const d = new Date(match[1])
  return isNaN(d.getTime()) ? null : d
}

function calculateAgeDays(timestamp: number | Date): number {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  const diffMs = Date.now() - date.getTime()
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
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

export function calculateBoost(
  nodeType: ParsedNode["nodeType"],
  searchKey: string,
  ageDays = 0,
): number {
  // Clamp so undated nodes (ageDays = UNDATED_AGE) contribute 0 rather than a
  // huge negative that would swamp the type boost, and so very old dated nodes
  // never underflow. Range: 0 (>=1000 days / undated) .. 1000 (age 0).
  const ageBoost = Math.max(0, 1000 - Math.min(ageDays, 1000))
  const typeBoost = (10 + BOOST[nodeType]) * 10000
  const emojiBoost = containsEmoji(searchKey) ? 1000 : 0
  return ageBoost + typeBoost + emojiBoost
}
