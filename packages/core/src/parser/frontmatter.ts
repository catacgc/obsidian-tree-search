import yaml from "js-yaml"

export type Frontmatter = Record<string, unknown>

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/

/**
 * Strip and parse YAML frontmatter from raw markdown content.
 * Returns the parsed frontmatter object and the byte offset where body starts.
 */
export function parseFrontmatter(content: string): {
  frontmatter: Frontmatter
  bodyStart: number
} {
  const match = content.match(FRONTMATTER_RE)
  if (!match) {
    return { frontmatter: {}, bodyStart: 0 }
  }
  let parsed: unknown
  try {
    parsed = yaml.load(match[1])
  } catch {
    parsed = {}
  }
  const fm = parsed && typeof parsed === "object" ? (parsed as Frontmatter) : {}
  return { frontmatter: fm, bodyStart: match[0].length }
}

/**
 * Extract aliases from frontmatter.
 * Supports both `aliases: [a, b]` and `aliases: a`.
 */
export function extractAliases(fm: Frontmatter): string[] {
  const raw = fm["aliases"]
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === "string")
  if (typeof raw === "string") return [raw]
  return []
}

/**
 * Extract tags from frontmatter.
 * Supports `tags: [a, b]` and `tags: a`.
 */
export function extractTags(fm: Frontmatter): string[] {
  const raw = fm["tags"]
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === "string")
  if (typeof raw === "string") return [raw]
  return []
}

/**
 * Extract a page's explicit date (ms epoch) from frontmatter, preferring
 * `updated` over `created`. Returns null when neither yields a valid date.
 *
 * js-yaml parses unquoted ISO dates into JS `Date` objects; quoted values and
 * other formats arrive as strings, which we run through `Date.parse`. Both
 * read a date-only `YYYY-MM-DD` as UTC midnight; it is a calendar day, so it
 * becomes local midnight (js-yaml's Date for it is exactly UTC midnight).
 */
export function extractPageDate(fm: Frontmatter): number | null {
  for (const field of ["updated", "created"]) {
    const raw = fm[field]
    let ts = NaN
    let dateOnly = false
    if (raw instanceof Date) {
      ts = raw.getTime()
      dateOnly = ts % 86_400_000 === 0
    } else if (typeof raw === "string") {
      ts = Date.parse(raw)
      dateOnly = /^\s*\d{4}-\d{2}-\d{2}\s*$/.test(raw)
    }
    if (isNaN(ts)) continue
    if (!dateOnly) return ts
    const utc = new Date(ts)
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate()).getTime()
  }
  return null
}

/**
 * Extract parent relation references from frontmatter.
 * parentRelation is the configurable field name (default: "parent").
 */
export function extractParents(fm: Frontmatter, parentRelation: string): string[] {
  const raw = fm[parentRelation]
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === "string") return [raw]
  return []
}
