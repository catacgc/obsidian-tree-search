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
  // Archived at index time: a note with the archive tag in its frontmatter (with its headings and lines), a heading
  // carrying `#archive` (with its subheadings and section lines), or a line carrying it (with everything nested under
  // it). `isArchived()` reads this; `partitionArchived` hides archived rows and everything under them in a result tree.
  archived?: boolean
  // Archived only through its note, an enclosing heading or a parent line: the tag isn't on this row itself.
  archiveInherited?: true
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
  /** `YYYY-MM-DD` taken from its earliest open subtask's scheduled/due date; `ageDays` then is that subtask's. */
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
  /** `![[…]]`: an embed (transclusion). It renders like a link but adds no parent edge. */
  embed?: true
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

export type ParsedTextToken = TextToken | ObsidianLinkToken | LinkToken | ImageToken | MetaActionToken

// ── Edge types ────────────────────────────────────────────────────────────────

export type EdgeAttributes = {
  mtime: number
  // "folder" is a filesystem-containment edge (folder → subfolder / folder →
  // contained note). Unlike "parent" (link/frontmatter hierarchy), it is only
  // traversed when a query targets folders (see buildTree), so folder trees
  // surface under `is:folder` without leaking into ordinary searches.
  type: "parent" | "related" | "month" | "folder"
  // Set on a "parent" edge the indexer adds because the child line links its source ([[note]] / [[note#heading]]):
  // an inline parent. Absent on outline parent edges (bullet nesting, heading, note, frontmatter `parent`). Edges are
  // unique per pair, so a pair that is both (a line under `- [[X]]` that also links [[X]]) is an outline edge.
  inline?: true
  location: Location
}

export type EdgeEntry = {
  edge: string
  source: string
  target: string
  attributes: EdgeAttributes
}

// ── DvPage-equivalent (output of the vault file parser) ───────────────────────

/** How a heading or line is archived: `own` carries the archive tag; `inherited` sits under an archived heading or
 *  line (in its note's outline). */
export type ArchiveMark = "own" | "inherited"

export type HeadingCache = {
  heading: string
  level: number
  position: {
    start: { line: number; ch: number }
    end: { line: number; ch: number }
  }
  archived?: ArchiveMark
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
  archived?: ArchiveMark
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
