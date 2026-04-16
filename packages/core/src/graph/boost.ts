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

export function getAgeDays(modifiedTime?: number | Date, filename?: string): number {
  if (filename) {
    const dateFromName = extractDateFromString(filename)
    if (dateFromName) return calculateAgeDays(dateFromName)
  }
  if (modifiedTime !== undefined) {
    return calculateAgeDays(modifiedTime)
  }
  return 0
}

export function calculateBoost(
  nodeType: ParsedNode["nodeType"],
  searchKey: string,
  ageDays = 0,
): number {
  const ageBoost = 1000 - ageDays
  const typeBoost = (10 + BOOST[nodeType]) * 10000
  const emojiBoost = containsEmoji(searchKey) ? 1000 : 0
  return ageBoost + typeBoost + emojiBoost
}
