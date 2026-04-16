// Graph
export type {
  Location,
  BaseNode,
  PageNode,
  HeaderNode,
  TextNode,
  FolderNode,
  AttachmentNode,
  MonthNode,
  FolderNote,
  PointerNode,
  ParsedNode,
  TextToken,
  ObsidianLinkToken,
  LinkToken,
  ImageToken,
  ParsedTextToken,
  EdgeAttributes,
  EdgeEntry,
  HeadingCache,
  DvList,
  DvPage,
} from "./graph/types.ts"

export { NotesGraph, getKey } from "./graph/graph.ts"
export { calculateBoost, getAgeDays, containsEmoji } from "./graph/boost.ts"
export { indexSinglePage, DEFAULT_SETTINGS, type IndexSettings } from "./graph/indexer.ts"

// Parser
export { parseVaultFile } from "./parser/vault-file.ts"
export { parseFrontmatter, extractAliases, extractTags, extractParents } from "./parser/frontmatter.ts"
export { scanMarkdown } from "./parser/list-scanner.ts"
export { parseTokens } from "./parser/inline-tokens.ts"
export { parseCanvasData, type CanvasData, type NodeTextLine } from "./parser/canvas.ts"
export { buildNodesFromTextLines } from "./parser/text-lines.ts"

// Search
export { searchIndex, advancedSearch, searchParents, flattenTasks, type ResultNode } from "./search/search.ts"
export { parseQuery, matchQuery, firstPassInclude, containsEmoji as queryContainsEmoji, type QueryExpr, type QueryModifier } from "./search/query.ts"
export { flattenIndex, type TreeNode } from "./search/flatten.ts"
export { reverseMarkdownParsing } from "./search/copy.ts"
