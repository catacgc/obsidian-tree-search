export type Location = {
  path: string
  position: {
    start: { line: number; ch: number }
    end: { line: number; ch: number }
  }
  canvasNode?: string
}

export type BaseNode = {
  searchKey: string
  location: Location
  boost: number
  ageDays: number
  // Intrinsic archive flag, derived at index time from any of the three
  // authoring forms (page frontmatter `#archive`, a line `#archive` tag, or a
  // `(meta-mdtree:: archive)` directive). `isArchived()` reads this (and, for
  // directly-constructed nodes, the directive token). Path-contextual
  // propagation to descendants happens at query time in `partitionArchived`.
  archived?: boolean
}

export type PageNode = BaseNode & {
  nodeType: "page"
  isReference: boolean
  page: string
  aliases: string[]
  tags: string[]
}

export type HeaderNode = BaseNode & {
  nodeType: "header"
  page: string
  header: string
  indent: number
}

export type TextNode = BaseNode & {
  nodeType: "text"
  parsedTokens: ParsedTextToken[]
  tags: string[]
  isTask: boolean
  isCompleted: boolean
  /** Its in-note parent is a text line: `is:subtask` (open task) / `is:subtext` (anything else). */
  nested?: true
  /** It has in-note text children: `is:list`. Search shows its children (compacted) and its block. */
  list?: true
  /** `YYYY-MM-DD` taken from its earliest-dated open subtask; `ageDays` then is that subtask's. */
  inheritedDate?: string
}

export type FolderNode = BaseNode & {
  nodeType: "folder"
  path: string
  name: string
  folderNote: string
}

export type AttachmentNode = BaseNode & {
  nodeType: "attachment"
  name: string
  extension: string
  aliases: string[]
}

export type MonthNode = BaseNode & {
  nodeType: "month"
  month: number
  monthLiteral: string
  year: number
}

export type FolderNote = BaseNode & {
  nodeType: "folderNote"
  folder: FolderNode
  page: PageNode
}

export type PointerNode = BaseNode & {
  nodeType: "pointer"
  target: string
}

export type ParsedNode = BaseNode &
  (
    | PageNode
    | TextNode
    | HeaderNode
    | MonthNode
    | FolderNode
    | AttachmentNode
    | FolderNote
    | PointerNode
  )

// ── Inline token types ────────────────────────────────────────────────────────

export type TextToken = {
  tokenType: "text"
  text: string
  decoration: "italic" | "bold" | "underline" | "strikethrough" | "code" | "none"
}

export type ObsidianLinkToken = {
  tokenType: "obsidian_link"
  source: string
  pageTarget: string
  alias?: string
  headerName?: string
}

export type LinkToken = {
  tokenType: "link"
  href: string
  content?: string
}

export type ImageToken = {
  tokenType: "image"
  src: string
  alt?: string
}

export type MetaActionToken = {
  tokenType: "meta_action"
  name: string
  url: string
  icon?: string
}

export type MetaMdtreeToken = {
  tokenType: "meta_mdtree"
  directive: string
}

export type ParsedTextToken = TextToken | ObsidianLinkToken | LinkToken | ImageToken | MetaActionToken | MetaMdtreeToken

// ── Edge types ────────────────────────────────────────────────────────────────

export type EdgeAttributes = {
  mtime: number
  // "folder" is a filesystem-containment edge (folder → subfolder / folder →
  // contained note). Unlike "parent" (link/frontmatter hierarchy), it is only
  // traversed when a query targets folders (see buildTree), so folder trees
  // surface under `is:folder` without leaking into ordinary searches.
  type: "parent" | "related" | "month" | "folder"
  location: Location
}

export type EdgeEntry = {
  edge: string
  source: string
  target: string
  attributes: EdgeAttributes
}

// ── DvPage-equivalent (output of the vault file parser) ───────────────────────

export type HeadingCache = {
  heading: string
  level: number
  position: {
    start: { line: number; ch: number }
    end: { line: number; ch: number }
  }
}

export type DvList = {
  link: { path: string }
  text: string
  rawText: string
  line: number
  position: {
    start: { line: number; col: number }
    end: { line: number; col: number }
  }
  parent?: number
  children: DvList[]
  tags: string[]
  section: { subpath: string }
  task: boolean
  completed: boolean
  /** Pre-computed inline tokens for rawText. Populated by native parser only. */
  precomputedTokens?: ParsedTextToken[]
}

export type DvPage = {
  file: {
    aliases: { values: string[] }
    name: string
    mtime: { ts: number }
    path: string
    frontmatter: Record<string, unknown>
    lists: { values: DvList[] }
    tags: string[]
  }
  headers: HeadingCache[]
  /** Pre-computed tokens for frontmatter parent strings. Populated by native parser only. */
  precomputedParentTokens?: Map<string, ParsedTextToken[]>
}
