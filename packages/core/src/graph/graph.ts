import type {
  AttachmentNode,
  BaseNode,
  EdgeAttributes,
  EdgeEntry,
  FolderNode,
  HeaderNode,
  Location,
  MonthNode,
  ObsidianLinkToken,
  PageNode,
  ParsedNode,
  ParsedTextToken,
  TextNode,
} from "./types.ts"
import { calculateBoost, getAgeDays } from "./boost.ts"

// ── Key derivation ─────────────────────────────────────────────────────────────

export function getKey(node: ParsedNode): string {
  switch (node.nodeType) {
    case "page":
      return `[[${node.page.toLowerCase().replace(/\.canvas$/, "")}]]`
    case "folderNote":
      return `folderNote:${node.folder.name.toLowerCase()}`
    case "pointer":
      return `pointer:${node.target}`
    case "header":
      return `${node.page}#${node.header}`.toLowerCase()
    case "text":
      return node.searchKey
    case "month":
      return `${node.year}-${node.month}`
    case "folder":
      return node.path.toLowerCase()
    case "attachment":
      return node.name.toLowerCase()
  }
}

// ── Edge storage ───────────────────────────────────────────────────────────────

type StoredEdge = {
  id: string
  from: string
  to: string
  attributes: EdgeAttributes
}

// ── NotesGraph ─────────────────────────────────────────────────────────────────

export class NotesGraph {
  private nodes = new Map<string, ParsedNode>()
  private out = new Map<string, StoredEdge[]>()
  private in = new Map<string, StoredEdge[]>()
  // edges indexed by the source file path that created them (location.path)
  private edgesByPath = new Map<string, StoredEdge[]>()
  // non-reference nodes indexed by their source file path
  private nodesByPath = new Map<string, Set<string>>()
  private edgeCounter = 0

  // ── Node operations ──────────────────────────────────────────────────────────

  addOrUpdateNode(node: ParsedNode): void {
    const key = getKey(node)
    if (!this.nodes.has(key)) {
      this.nodes.set(key, { ...node })
    } else if (node.nodeType === "page") {
      this.nodes.set(key, this.mergePageNode(this.nodes.get(key) as PageNode, node))
    } else if (node.nodeType === "header") {
      this.nodes.set(key, this.mergeHeaderNode(this.nodes.get(key) as HeaderNode, node))
    }
  }

  private mergePageNode(existing: PageNode, incoming: PageNode): PageNode {
    const aliases = [...new Set([...existing.aliases, ...incoming.aliases])]
    const isReference = existing.isReference && incoming.isReference
    const searchKey = `${existing.page}|${aliases.join(" ")}`.toLowerCase()
    return {
      ...existing,
      aliases,
      isReference,
      searchKey,
      boost: Math.max(existing.boost, incoming.boost),
    }
  }

  private mergeHeaderNode(existing: HeaderNode, incoming: HeaderNode): HeaderNode {
    return {
      ...existing,
      indent: Math.max(existing.indent, incoming.indent),
      boost: Math.max(existing.boost, incoming.boost),
    }
  }

  hasNode(key: string): boolean {
    return this.nodes.has(key)
  }

  getNodeAttributes(key: string): ParsedNode {
    const node = this.nodes.get(key)
    if (!node) throw new Error(`Node not found: ${key}`)
    return node
  }

  filterNodes(fn: (key: string, attrs: ParsedNode) => boolean): string[] {
    const result: string[] = []
    for (const [key, attrs] of this.nodes) {
      if (fn(key, attrs)) result.push(key)
    }
    return result
  }

  get order(): number {
    return this.nodes.size
  }

  // ── Edge operations ──────────────────────────────────────────────────────────

  private addEdge(from: string, to: string, attrs: EdgeAttributes): void {
    if (from === to) return
    if (!this.nodes.has(from) || !this.nodes.has(to)) return
    // deduplicate: only one edge per (from, to) pair
    const existing = this.out.get(from)
    if (existing?.some(e => e.to === to)) return

    const id = `e${++this.edgeCounter}`
    const edge: StoredEdge = { id, from, to, attributes: attrs }

    if (!this.out.has(from)) this.out.set(from, [])
    this.out.get(from)!.push(edge)

    if (!this.in.has(to)) this.in.set(to, [])
    this.in.get(to)!.push(edge)

    const path = attrs.location.path
    if (!this.edgesByPath.has(path)) this.edgesByPath.set(path, [])
    this.edgesByPath.get(path)!.push(edge)
  }

  addChild(
    parent: ParsedNode,
    child: ParsedNode,
    location: BaseNode["location"],
    mtime: number,
  ): void {
    this.addEdge(getKey(parent), getKey(child), { mtime, type: "parent", location })
  }

  addRelatedEdge(fromKey: string, toKey: string, location: Location, mtime = 0): void {
    this.addEdge(fromKey, toKey, { mtime, type: "related", location })
  }

  hasEdge(from: string, to: string): boolean {
    return this.out.get(from)?.some(e => e.to === to) ?? false
  }

  outboundEdgeEntries(key: string): EdgeEntry[] {
    return (this.out.get(key) ?? []).map(e => ({
      edge: e.id,
      source: e.from,
      target: e.to,
      attributes: e.attributes,
    }))
  }

  inboundEdgeEntries(key: string): EdgeEntry[] {
    return (this.in.get(key) ?? []).map(e => ({
      edge: e.id,
      source: e.from,
      target: e.to,
      attributes: e.attributes,
    }))
  }

  get size(): number {
    let count = 0
    for (const edges of this.out.values()) count += edges.length
    return count
  }

  // ── Incremental update ───────────────────────────────────────────────────────

  /** Remove all edges whose location.path == srcPath, then prune dangling refs */
  removeByPath(srcPath: string): void {
    const edges = this.edgesByPath.get(srcPath) ?? []
    for (const edge of edges) {
      // remove from out-map
      const outList = this.out.get(edge.from)
      if (outList) {
        const idx = outList.indexOf(edge)
        if (idx !== -1) outList.splice(idx, 1)
      }
      // remove from in-map
      const inList = this.in.get(edge.to)
      if (inList) {
        const idx = inList.indexOf(edge)
        if (idx !== -1) inList.splice(idx, 1)
      }
    }
    this.edgesByPath.delete(srcPath)

    // remove nodes exclusively created by this file (non-real pages)
    const ownedKeys = this.nodesByPath.get(srcPath) ?? new Set()
    for (const key of ownedKeys) {
      const node = this.nodes.get(key)
      if (!node) continue
      // keep real (non-reference) page nodes — they get merged on re-index
      if (node.nodeType === "page" && !node.isReference) continue
      // remove node if it has no remaining edges
      const hasOut = (this.out.get(key)?.length ?? 0) > 0
      const hasIn = (this.in.get(key)?.length ?? 0) > 0
      if (!hasOut && !hasIn) {
        this.nodes.delete(key)
        this.out.delete(key)
        this.in.delete(key)
      }
    }
    this.nodesByPath.delete(srcPath)
  }

  /** Track that a node was created by a specific file (for incremental cleanup) */
  trackNodePath(key: string, srcPath: string): void {
    if (!this.nodesByPath.has(srcPath)) this.nodesByPath.set(srcPath, new Set())
    this.nodesByPath.get(srcPath)!.add(key)
  }

  // ── High-level node builders (ported from NotesGraph in graph.ts) ────────────

  createVirtualPage(
    ref: ObsidianLinkToken,
    location: BaseNode["location"],
    ageDays: number,
  ): PageNode | HeaderNode {
    const aliases = ref.alias ? [ref.alias] : []
    const searchKey = ref.pageTarget.toLowerCase()
    const page: PageNode = {
      nodeType: "page",
      isReference: true,
      page: ref.pageTarget,
      aliases,
      tags: [],
      location,
      searchKey,
      boost: calculateBoost("page", searchKey, ageDays),
      ageDays,
    }
    this.addOrUpdateNode(page)
    this.trackNodePath(getKey(page), location.path)

    if (ref.headerName) {
      const headerSearchKey = `${ref.pageTarget}#${ref.headerName}`.toLowerCase()
      const header: HeaderNode = {
        nodeType: "header",
        page: ref.pageTarget,
        header: ref.headerName,
        indent: -1,
        location,
        searchKey: headerSearchKey,
        boost: calculateBoost("header", headerSearchKey, ageDays),
        ageDays,
      }
      this.addOrUpdateNode(header)
      this.trackNodePath(getKey(header), location.path)
      return header
    }
    return page
  }

  getObsidianLinkReferences(tokens: ParsedTextToken[]): ObsidianLinkToken[] {
    return tokens.filter(
      (t): t is ObsidianLinkToken => t.tokenType === "obsidian_link",
    )
  }

  createRefsNodes(
    refs: ObsidianLinkToken[],
    textNode: TextNode,
    ageDays: number,
  ): ParsedNode[] {
    return refs.map(ref => this.createVirtualPage(ref, textNode.location, ageDays))
  }

  createHeaderNode(
    page: string,
    heading: string,
    location: BaseNode["location"],
    indent = -1,
    modifiedTime?: number,
    filename?: string,
  ): HeaderNode {
    const searchKey = `${page}#${heading}`.toLowerCase()
    const ageDays = getAgeDays(modifiedTime, filename ? filename + heading : undefined)
    const node: HeaderNode = {
      nodeType: "header",
      page,
      header: heading,
      indent,
      location,
      searchKey,
      boost: calculateBoost("header", searchKey, ageDays),
      ageDays,
    }
    this.addOrUpdateNode(node)
    return node
  }

  createFolderNode(
    folderPath: string,
    folderName: string,
    location: Location,
  ): FolderNode {
    const searchKey = (folderName || "(root)").toLowerCase()
    const ageDays = getAgeDays(undefined, folderName)
    const node: FolderNode = {
      nodeType: "folder",
      path: folderPath,
      name: folderName,
      folderNote: `${folderPath}/${folderName || "root"}.md`,
      location,
      searchKey,
      boost: calculateBoost("folder", searchKey, ageDays),
      ageDays,
    }
    this.addOrUpdateNode(node)
    return node
  }

  addAttachmentNode(
    name: string,
    extension: string,
    filePath: string,
    mtime: number,
  ): AttachmentNode {
    const searchKey = name.toLowerCase()
    const ageDays = getAgeDays(mtime, name)
    const node: AttachmentNode = {
      nodeType: "attachment",
      name,
      extension,
      aliases: [],
      location: {
        path: filePath,
        position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } },
      },
      searchKey,
      boost: calculateBoost("attachment", searchKey, ageDays),
      ageDays,
    }
    this.addOrUpdateNode(node)
    return node
  }

  addMonthNode(ts: number, filePath: string): MonthNode {
    const date = new Date(ts)
    const monthLiteral = date.toLocaleString("default", { month: "long" })
    const searchKey = `${monthLiteral} ${date.getFullYear()}`.toLowerCase()
    const ageDays = getAgeDays(ts)
    const node: MonthNode = {
      nodeType: "month",
      month: date.getMonth() + 1,
      year: date.getFullYear(),
      monthLiteral,
      location: {
        path: filePath,
        position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } },
      },
      searchKey,
      boost: calculateBoost("month", searchKey, ageDays),
      ageDays,
    }
    this.addOrUpdateNode(node)
    return node
  }

  /** Remove all edges created by a page's file (before re-indexing it) */
  removeExistingPageEdges(page: PageNode): void {
    this.removeByPath(page.location.path)
  }
}
