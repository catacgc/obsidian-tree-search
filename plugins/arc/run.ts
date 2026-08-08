#!/usr/bin/env bun
/**
 * Arc Browser plugin for mdtree
 *
 * Reads config from stdin as JSON, writes a Markdown tree to stdout.
 * Scans the pinned links and folders of every Arc space (workspace) from
 * Arc's local sidebar file and renders them as a searchable tree:
 *   ## <Space title>
 *   - <Folder name>
 *     - [Pinned tab title](https://...)
 *
 * Data source: Arc's StorableSidebar.json (default location on macOS:
 * ~/Library/Application Support/Arc/StorableSidebar.json). Only *pinned*
 * items are indexed — open/unpinned tabs are ignored.
 */

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// ── Config ──────────────────────────────────────────────────────────────────

interface Config {
  sidebarPath?: string
  spaces?: string
}

function defaultSidebarPath(): string {
  return join(homedir(), "Library", "Application Support", "Arc", "StorableSidebar.json")
}

// ── Parsed tree model ─────────────────────────────────────────────────────────

export type ArcNode =
  | { type: "folder"; title: string; children: ArcNode[] }
  | { type: "link"; title: string; url: string }

export interface ArcSpace {
  title: string
  tree: ArcNode[]
}

// ── Raw Arc sidebar shapes (loosely typed) ──────────────────────────────────

interface ArcItem {
  id: string
  title?: string | null
  childrenIds?: string[]
  data?: {
    tab?: { savedTitle?: string | null; savedURL?: string | null }
    list?: unknown
  }
}

interface ArcSpaceRaw {
  id: string
  title?: string | null
  containerIDs?: unknown[]
}

interface ArcContainer {
  items?: unknown[]
  spaces?: unknown[]
}

/**
 * Arc stores `items` and `spaces` as alternating [idString, object, ...] arrays.
 * Keep only the object entries.
 */
function objectsOnly<T>(arr: unknown[] | undefined): T[] {
  if (!Array.isArray(arr)) return []
  return arr.filter((x): x is T => !!x && typeof x === "object")
}

/**
 * The sidebar file holds several containers; the live one has both an `items`
 * array and a `spaces` array with real space objects. Stale containers hold only
 * a couple of placeholder items, so pick the container with the most item objects
 * that also has at least one space object.
 */
function selectLiveContainer(containers: unknown[]): ArcContainer | null {
  let best: ArcContainer | null = null
  let bestCount = -1
  for (const c of objectsOnly<ArcContainer>(containers)) {
    const itemCount = objectsOnly<ArcItem>(c.items).length
    const spaceCount = objectsOnly<ArcSpaceRaw>(c.spaces).length
    if (spaceCount > 0 && itemCount > bestCount) {
      best = c
      bestCount = itemCount
    }
  }
  return best
}

function cleanTitle(raw: string | null | undefined, fallback: string): string {
  const t = (raw ?? "").replace(/\s+/g, " ").trim()
  return t || fallback
}

/**
 * Pure parser: turns the parsed StorableSidebar.json into a list of spaces, each
 * with a tree of pinned folders/links. `spaceFilter`, when non-empty, restricts
 * output to spaces whose (case-insensitive) title is in the set.
 */
export function parseArcSidebar(json: unknown, spaceFilter?: Set<string>): ArcSpace[] {
  const containers = (json as { sidebar?: { containers?: unknown[] } })?.sidebar?.containers
  if (!Array.isArray(containers)) return []

  const container = selectLiveContainer(containers)
  if (!container) return []

  const items = new Map<string, ArcItem>()
  for (const it of objectsOnly<ArcItem>(container.items)) {
    if (it.id) items.set(it.id, it)
  }

  const buildNode = (id: string): ArcNode | null => {
    const item = items.get(id)
    if (!item) return null

    const url = item.data?.tab?.savedURL
    if (url) {
      const savedTitle = item.data?.tab?.savedTitle
      return { type: "link", title: cleanTitle(savedTitle, url), url }
    }

    const children = (item.childrenIds ?? [])
      .map(buildNode)
      .filter((n): n is ArcNode => n !== null)

    const isFolder = item.data != null && "list" in (item.data as object)
    if (isFolder || children.length > 0) {
      return { type: "folder", title: cleanTitle(item.title, "Untitled"), children }
    }
    return null
  }

  const spaces: ArcSpace[] = []
  for (const space of objectsOnly<ArcSpaceRaw>(container.spaces)) {
    const title = cleanTitle(space.title, "Untitled space")
    if (spaceFilter && spaceFilter.size > 0 && !spaceFilter.has(title.toLowerCase())) {
      continue
    }

    const cids = Array.isArray(space.containerIDs) ? space.containerIDs : []
    const pinnedIdx = cids.indexOf("pinned")
    const pinnedRootId = pinnedIdx >= 0 ? cids[pinnedIdx + 1] : undefined
    if (typeof pinnedRootId !== "string") continue

    const root = items.get(pinnedRootId)
    const tree = (root?.childrenIds ?? [])
      .map(buildNode)
      .filter((n): n is ArcNode => n !== null)

    spaces.push({ title, tree })
  }

  return spaces
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

/** Sanitize text used as a Markdown link label so brackets don't break parsing. */
function label(text: string): string {
  return text.replace(/[[\]]/g, "")
}

/** Sanitize text used inside an Obsidian [[wikilink]] so it stays a valid link. */
function wikilink(text: string): string {
  return text.replace(/[[\]|#^]/g, "").trim() || "Untitled"
}

/** True when every "(" has a matching ")" and none close early. */
function parensBalanced(url: string): boolean {
  let depth = 0
  for (const ch of url) {
    if (ch === "(") depth++
    else if (ch === ")" && --depth < 0) return false
  }
  return depth === 0
}

/**
 * Markdown link destination. The plain `(url)` form breaks when the URL contains
 * whitespace or unbalanced parentheses (common in Jira/SharePoint URLs), so wrap
 * those in the angle-bracket form `<url>`, which allows both.
 */
function linkDestination(url: string): string {
  if (!/\s/.test(url) && parensBalanced(url)) return url
  return `<${url.replace(/</g, "%3C").replace(/>/g, "%3E")}>`
}

function renderNode(node: ArcNode, depth: number, lines: string[]): void {
  const indent = "  ".repeat(depth)
  if (node.type === "link") {
    lines.push(`${indent}- [${label(node.title)}](${linkDestination(node.url)})`)
  } else {
    // Folders become notes so they can be navigated / linked in the graph.
    lines.push(`${indent}- [[${wikilink(node.title)}]]`)
    for (const child of node.children) renderNode(child, depth + 1, lines)
  }
}

export function renderSpaces(spaces: ArcSpace[]): string {
  const lines: string[] = []
  for (const space of spaces) {
    lines.push(`## ${space.title}`)
    for (const node of space.tree) renderNode(node, 0, lines)
    lines.push("")
  }
  return lines.join("\n").trimEnd() + "\n"
}

// ── Main ──────────────────────────────────────────────────────────────────────

function parseSpaceFilter(spaces: string | undefined): Set<string> {
  const set = new Set<string>()
  for (const name of (spaces ?? "").split(",")) {
    const trimmed = name.trim().toLowerCase()
    if (trimmed) set.add(trimmed)
  }
  return set
}

async function main() {
  const raw = await new Response(Bun.stdin.stream()).text()
  const config = (raw.trim() ? JSON.parse(raw.trim()) : {}) as Config

  const sidebarPath = config.sidebarPath?.trim() || defaultSidebarPath()

  let json: unknown
  try {
    json = JSON.parse(readFileSync(sidebarPath, "utf8"))
  } catch (err) {
    throw new Error(`could not read Arc sidebar at ${sidebarPath}: ${(err as Error).message}`)
  }

  const spaces = parseArcSidebar(json, parseSpaceFilter(config.spaces))
  process.stdout.write(renderSpaces(spaces))
}

// Only run when executed directly (not when imported by tests).
if (import.meta.main) {
  main().catch(err => {
    console.error(`[arc] ${(err as Error).message}`)
    process.exit(1)
  })
}
