/**
 * Deterministic synthetic vault generator for benchmarking.
 * Produces a Record<string, string> (path -> markdown content).
 * All generation is index-based (no randomness) for reproducibility.
 */

export type VaultOptions = {
  fileCount?: number // default 2000
  itemsPerFile?: number // default 20
  headersPerFile?: number // default 3
  linkDensity?: number // 0-1, fraction of items with obsidian links (default 0.7)
  tagDensity?: number // 0-1, fraction of items with inline tags (default 0.3)
  taskDensity?: number // 0-1, fraction of items that are tasks (default 0.2)
  metaActionDensity?: number // 0-1, fraction of items with meta-actions (default 0.1)
  parentRelationDensity?: number // 0-1, fraction of files with frontmatter parent (default 0.4)
}

const TAGS = ["project", "work", "personal", "review", "idea", "meeting", "reference", "todo", "done", "archive"]
const ALIASES = ["Quick Note", "Summary", "Overview", "Main Page", "Draft", "Research"]
const PAGE_NAMES = ["Dashboard", "Projects", "Tasks", "Notes", "Ideas", "Meetings", "Research", "Archive", "Planning", "Review"]

function generateFrontmatter(fileIndex: number, opts: Required<VaultOptions>): string {
  const lines: string[] = ["---"]

  // Tags in frontmatter (60%+ of files)
  if (fileIndex % 5 < 3) {
    const tag1 = TAGS[fileIndex % TAGS.length]
    const tag2 = TAGS[(fileIndex + 3) % TAGS.length]
    lines.push(`tags: [${tag1}, ${tag2}]`)
  }

  // Aliases (40% of files)
  if (fileIndex % 5 < 2) {
    const alias = ALIASES[fileIndex % ALIASES.length]
    lines.push(`aliases: ["${alias} ${fileIndex}"]`)
  }

  // Parent relation with obsidian link (40% controlled by parentRelationDensity)
  if ((fileIndex % 100) / 100 < opts.parentRelationDensity) {
    const parentTarget = PAGE_NAMES[fileIndex % PAGE_NAMES.length]
    lines.push(`parent: "[[${parentTarget}]]"`)
  }

  // Extra frontmatter fields for realism
  if (fileIndex % 3 === 0) {
    lines.push(`created: 2024-01-${String((fileIndex % 28) + 1).padStart(2, "0")}`)
  }
  if (fileIndex % 7 === 0) {
    lines.push(`status: active`)
  }

  lines.push("---")
  return lines.join("\n")
}

function generateListItem(
  fileIndex: number,
  itemIndex: number,
  indentLevel: number,
  opts: Required<VaultOptions>,
): string {
  const indent = "  ".repeat(indentLevel)
  const globalIdx = fileIndex * opts.itemsPerFile + itemIndex

  // Determine if this is a task
  const isTask = (globalIdx % 100) / 100 < opts.taskDensity
  let prefix: string
  if (isTask) {
    prefix = globalIdx % 3 === 0 ? "- [x]" : "- [ ]"
  } else {
    // Vary bullet types
    const bulletTypes = ["-", "-", "-", "*", "+"]
    prefix = bulletTypes[globalIdx % bulletTypes.length]
  }

  // Build item text
  let text = `Item ${fileIndex}-${itemIndex}`

  // Obsidian links
  const hasLink = (globalIdx % 100) / 100 < opts.linkDensity
  if (hasLink) {
    const linkVariant = globalIdx % 5
    const targetPage = PAGE_NAMES[(fileIndex + itemIndex) % PAGE_NAMES.length]
    switch (linkVariant) {
      case 0:
        text += ` see [[${targetPage}]]`
        break
      case 1:
        text += ` relates to [[${targetPage}#Section|alias]]`
        break
      case 2:
        text += ` check [[folder/${targetPage}]]`
        break
      case 3:
        text += ` link [[${targetPage}#Header]]`
        break
      case 4:
        text += ` ref [[${targetPage}|Display Name]]`
        break
    }
  }

  // Markdown links (every 7th item when no obsidian link)
  if (!hasLink && globalIdx % 7 === 0) {
    text += ` [documentation](http://example.com/docs/${fileIndex})`
  }

  // HTTP URLs (every 11th item)
  if (globalIdx % 11 === 0) {
    text += ` http://example.com/resource/${globalIdx}`
  }

  // Inline tags
  const hasTag = (globalIdx % 100) / 100 < opts.tagDensity
  if (hasTag) {
    const tag = TAGS[(fileIndex + itemIndex * 2) % TAGS.length]
    text += ` #${tag}`
  }

  // Meta-actions
  const hasMetaAction = (globalIdx % 100) / 100 < opts.metaActionDensity
  if (hasMetaAction) {
    text += ` (meta-action-name::Action${globalIdx})(meta-action-url::https://action.example.com/${globalIdx})`
  }

  return `${indent}${prefix} ${text}`
}

function generateFileContent(fileIndex: number, opts: Required<VaultOptions>): string {
  const sections: string[] = []

  // Frontmatter
  sections.push(generateFrontmatter(fileIndex, opts))
  sections.push("")

  // Distribute items across headers
  const itemsPerSection = Math.ceil(opts.itemsPerFile / opts.headersPerFile)
  let itemCounter = 0

  for (let h = 0; h < opts.headersPerFile; h++) {
    // Header
    const headerLevel = h === 0 ? 1 : h <= 1 ? 2 : 3
    const headerPrefix = "#".repeat(headerLevel)
    const headerNames = ["Overview", "Tasks", "Notes", "References", "Details"]
    sections.push(`${headerPrefix} ${headerNames[h % headerNames.length]}`)
    sections.push("")

    // List items under this header
    const itemsInThisSection = h === opts.headersPerFile - 1
      ? opts.itemsPerFile - itemCounter
      : itemsPerSection

    for (let i = 0; i < itemsInThisSection && itemCounter < opts.itemsPerFile; i++) {
      // Determine nesting: ~30% of items are nested (children)
      let indentLevel = 0
      if (itemCounter > 0 && itemCounter % 3 === 2) {
        indentLevel = 1
      } else if (itemCounter > 1 && itemCounter % 7 === 6) {
        indentLevel = 2
      }

      sections.push(generateListItem(fileIndex, itemCounter, indentLevel, opts))
      itemCounter++
    }
    sections.push("")
  }

  return sections.join("\n")
}

function generateFilePath(fileIndex: number): string {
  // Distribute files across folders for realism
  const folders = ["projects", "notes", "meetings", "ideas", "research"]
  const subFolders = ["active", "completed", "pending", "review"]

  if (fileIndex % 10 < 3) {
    // 30% in root
    return `note-${fileIndex}.md`
  } else if (fileIndex % 10 < 7) {
    // 40% in top-level folder
    const folder = folders[fileIndex % folders.length]
    return `${folder}/note-${fileIndex}.md`
  } else {
    // 30% in nested folder
    const folder = folders[fileIndex % folders.length]
    const sub = subFolders[fileIndex % subFolders.length]
    return `${folder}/${sub}/note-${fileIndex}.md`
  }
}

export function generateVault(options: VaultOptions = {}): Record<string, string> {
  const opts: Required<VaultOptions> = {
    fileCount: options.fileCount ?? 2000,
    itemsPerFile: options.itemsPerFile ?? 20,
    headersPerFile: options.headersPerFile ?? 3,
    linkDensity: options.linkDensity ?? 0.7,
    tagDensity: options.tagDensity ?? 0.3,
    taskDensity: options.taskDensity ?? 0.2,
    metaActionDensity: options.metaActionDensity ?? 0.1,
    parentRelationDensity: options.parentRelationDensity ?? 0.4,
  }

  const vault: Record<string, string> = {}

  for (let i = 0; i < opts.fileCount; i++) {
    const path = generateFilePath(i)
    vault[path] = generateFileContent(i, opts)
  }

  return vault
}
