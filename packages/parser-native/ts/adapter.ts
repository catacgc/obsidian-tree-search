import type { DvList, DvPage, Frontmatter, HeadingCache, ParsedTextToken } from "@mdtree/core"

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

/**
 * Deserialize the JSON output from the WASM `parse_tokens` function
 * into a typed ParsedTextToken[] matching the TS parser output shape.
 *
 * The JSON output from Rust already matches the TypeScript type structure:
 * - `#[serde(tag = "tokenType")]` produces `{ "tokenType": "obsidian_link", ... }`
 * - `#[serde(skip_serializing_if = "Option::is_none")]` omits undefined fields
 * - Field names use correct casing via `#[serde(rename = "...")]`
 * - `Image.alt` is always a String (never Option), so always serialized
 */
export function adaptParseTokens(json: string): ParsedTextToken[] {
  return JSON.parse(json) as ParsedTextToken[]
}

// ── Batch API adapter types ─────────────────────────────────────────────────

type RawBatchDvListItem = RawDvListItem & {
  precomputedTokens: ParsedTextToken[]
}

type RawBatchParsedPage = {
  file: {
    aliases: { values: string[] }
    name: string
    mtime: { ts: number }
    path: string
    frontmatter: Record<string, unknown>
    lists: { values: RawBatchDvListItem[] }
    tags: string[]
  }
  headers: HeadingCache[]
  precomputedParentTokens: Record<string, ParsedTextToken[]>
}

// ── Batch API adapter functions ─────────────────────────────────────────────

/**
 * Deserialize the JSON output from the WASM `batch_parse_chunk` function
 * into DvPage[] with precomputedTokens populated on every DvList item.
 */
export function adaptBatchResult(json: string): DvPage[] {
  const parsed = JSON.parse(json) as RawBatchParsedPage[]
  return parsed.map(adaptBatchPage)
}

/**
 * Deserialize the JSON output from the WASM `parse_single_file` function
 * into a single DvPage with precomputedTokens populated.
 */
export function adaptSingleResult(json: string): DvPage {
  const parsed = JSON.parse(json) as RawBatchParsedPage
  return adaptBatchPage(parsed)
}

function adaptBatchPage(raw: RawBatchParsedPage): DvPage {
  // Convert precomputedParentTokens from Record to Map
  const parentTokens = new Map<string, ParsedTextToken[]>()
  if (raw.precomputedParentTokens) {
    for (const [key, value] of Object.entries(raw.precomputedParentTokens)) {
      parentTokens.set(key, value)
    }
  }

  return {
    file: {
      aliases: raw.file.aliases,
      name: raw.file.name,
      mtime: raw.file.mtime,
      path: raw.file.path,
      frontmatter: raw.file.frontmatter,
      lists: { values: raw.file.lists.values.map(adaptBatchListItem) },
      tags: raw.file.tags,
    },
    headers: raw.headers ?? [],
    precomputedParentTokens: parentTokens.size > 0 ? parentTokens : undefined,
  }
}

function adaptBatchListItem(raw: RawBatchDvListItem): DvList {
  return {
    link: raw.link,
    text: raw.text,
    rawText: raw.rawText,
    line: raw.line,
    position: raw.position,
    parent: raw.parent === null ? undefined : raw.parent,
    children: (raw.children as RawBatchDvListItem[]).map(adaptBatchListItem),
    tags: raw.tags,
    section: raw.section,
    task: raw.task,
    completed: raw.completed,
    precomputedTokens: raw.precomputedTokens,
  }
}
