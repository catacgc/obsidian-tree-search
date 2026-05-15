import type { DvList, Frontmatter, HeadingCache } from "@mdtree/core"

/**
 * Deserialize the JSON output from the WASM `parse_frontmatter` function
 * into a typed result matching the TS parser output shape.
 */
export function adaptFrontmatter(json: string): { frontmatter: Frontmatter; bodyStart: number } {
  const parsed = JSON.parse(json) as { frontmatter: Record<string, unknown>; bodyStart: number }
  return {
    frontmatter: parsed.frontmatter ?? {},
    bodyStart: parsed.bodyStart ?? 0,
  }
}

/**
 * Deserialize the JSON output from the WASM `scan_markdown` function
 * into typed DvList[] and HeadingCache[] matching the TS parser output shape.
 *
 * Key transformations:
 * - `parent: null` → `parent: undefined` (TS semantics for absent parent)
 * - HeadingCache position uses `ch` (already correct from Rust serialization)
 * - Children are already nested objects in the JSON (Rust post-pass produces them)
 */
export function adaptScanResult(json: string): { lists: DvList[]; headers: HeadingCache[] } {
  const parsed = JSON.parse(json) as { lists: RawDvListItem[]; headers: HeadingCache[] }
  return {
    lists: parsed.lists.map(adaptListItem),
    headers: parsed.headers ?? [],
  }
}

type RawDvListItem = {
  link: { path: string }
  text: string
  rawText: string
  line: number
  position: {
    start: { line: number; col: number }
    end: { line: number; col: number }
  }
  parent: number | null
  children: RawDvListItem[]
  tags: string[]
  section: { subpath: string }
  task: boolean
  completed: boolean
}

function adaptListItem(raw: RawDvListItem): DvList {
  const item: DvList = {
    link: raw.link,
    text: raw.text,
    rawText: raw.rawText,
    line: raw.line,
    position: raw.position,
    parent: raw.parent === null ? undefined : raw.parent,
    children: raw.children.map(adaptListItem),
    tags: raw.tags,
    section: raw.section,
    task: raw.task,
    completed: raw.completed,
  }
  return item
}
