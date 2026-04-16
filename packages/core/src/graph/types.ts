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

export type ParsedTextToken = TextToken | ObsidianLinkToken | LinkToken | ImageToken | MetaActionToken

// ── Edge types ────────────────────────────────────────────────────────────────

export type EdgeAttributes = {
  mtime: number
  type: "parent" | "related" | "month"
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
}
