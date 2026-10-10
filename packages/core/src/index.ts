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
  MetaActionToken,
  MetaMdtreeToken,
  ParsedTextToken,
  EdgeAttributes,
  EdgeEntry,
  HeadingCache,
  DvList,
  DvPage,
} from "./graph/types.ts"

export { NotesGraph, getKey } from "./graph/graph.ts"
export { calculateBoost, getAgeDays, ageDaysFromText, isUndated, UNDATED_AGE, containsEmoji } from "./graph/boost.ts"
export { indexSinglePage, DEFAULT_SETTINGS, type IndexSettings } from "./graph/indexer.ts"
export { buildGraphFromScanner, reindexFileInGraph, type ParseCacheEntry } from "./graph/builder.ts"
export { serializeCache, deserializeCache } from "./graph/cache.ts"
export type { VaultScanner, VaultFile, VaultFolder, WalkResult } from "./graph/scanner.ts"

// Parser
export { parseVaultFile } from "./parser/vault-file.ts"
export { parseFrontmatter, extractAliases, extractTags, extractParents, extractPageDate, type Frontmatter } from "./parser/frontmatter.ts"
export { makePeriodicDateResolver, type PeriodicNoteConfig, type MomentParse } from "./parser/periodic-notes.ts"
export { scanMarkdown } from "./parser/list-scanner.ts"
export { parseTokens, stripUrlQueryStrings } from "./parser/inline-tokens.ts"
export { parseCanvasData, type CanvasData, type NodeTextLine } from "./parser/canvas.ts"
export { buildNodesFromTextLines } from "./parser/text-lines.ts"

// Search
export { searchIndex, advancedSearch, searchParents, flattenTasks, pruneResultTree, linkTargetTree, type ResultNode, type SearchOptions } from "./search/search.ts"
export { parseQuery, parseDuration, matchQuery, firstPassInclude, nodeMatchesQuery, collectModifiers, extractArchiveReveal, containsEmoji as queryContainsEmoji, type QueryExpr, type QueryModifierField } from "./search/query.ts"
export { suggestAt, spliceSuggestion, type Suggestion } from "./search/suggest.ts"
export { describeQuerySyntax, type QuerySyntaxEntry, type QuerySyntaxGroup } from "./search/syntax.ts"
export { flattenIndex, defaultVisibility, type TreeNode } from "./search/flatten.ts"
export { buildTimeline, fileParent, type TimelineItem } from "./search/timeline.ts"
export { pruneToRecency } from "./search/recency.ts"
export { formatRelativeDate, textSourceDate } from "./search/relative-date.ts"
export { reverseMarkdownParsing } from "./search/copy.ts"
export { isArchived, partitionArchived } from "./search/archive.ts"
export {
  buildPullTree,
  formatOccurrenceDate,
  planOrganiseWrites,
  planDeletions,
  isFrontmatterRelation,
  renderPullLine,
  type PullNode,
  type PullLine,
  type OrganiseHome,
  type SectionWrite,
  type PullDeletion,
} from "./search/pull.ts"
export { upsertOrganiseSections } from "./search/organise-sections.ts"

// Edit
export { LIST_ITEM_RE, HEADER_RE } from "./parser/list-scanner.ts"
export { splitLines } from "./search/organise-sections.ts"
export {
  parseOutline,
  renderOutline,
  findOutlineEnd,
  findSubtreeEnd,
  findLinkBullet,
  appendUnderLinkBullet,
  appendOutline,
  firstAppendedLine,
  linkOnlyTarget,
  appendContent,
  splitEditableLine,
  lineHasIdentity,
  replaceLineText,
  cutSubtree,
  pasteUnderLinkBullet,
  pasteAtOutlineEnd,
  StaleLineError,
  type OutlineLine,
  type OutlineIssue,
} from "./edit/outline-edit.ts"
export { setTaskDone, scheduleTask, rescheduleDate, localIsoDate, type RescheduleKind } from "./edit/task-edit.ts"
export {
  slugify,
  attachmentKind,
  attachmentExt,
  attachmentName,
  resolveAttachmentEmbeds,
  OUTLINE_KEY,
  INVALID_NAME_RE,
  type AttachmentKind,
  type SessionAttachment,
  type AttachmentPlan,
} from "./edit/attachments.ts"
export { editorHints, appendOutlineEmpty, type EditorHint } from "./edit/editor-hints.ts"
