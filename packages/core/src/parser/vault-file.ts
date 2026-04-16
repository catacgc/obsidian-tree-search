import type { DvPage } from "../graph/types.ts"
import {
  extractAliases,
  extractTags,
  parseFrontmatter,
} from "./frontmatter.ts"
import { scanMarkdown } from "./list-scanner.ts"

/**
 * Parse a single markdown file into a DvPage-equivalent structure.
 * This replaces the Dataview `dv.page()` + `metadataCache.getCache()` calls.
 *
 * @param content  Raw file content
 * @param filePath Vault-relative file path (e.g. "projects/my-note.md")
 * @param mtime    File modification time in milliseconds
 * @param archiveTag Tag name (without #) used to skip archived items
 */
export function parseVaultFile(
  content: string,
  filePath: string,
  mtime: number,
  archiveTag = "archive",
): DvPage {
  const { frontmatter, bodyStart } = parseFrontmatter(content)

  const name = filePath
    .split("/")
    .pop()!
    .replace(/\.md$/, "")

  const { lists, headers } = scanMarkdown(content, filePath, bodyStart, archiveTag)

  return {
    file: {
      aliases: { values: extractAliases(frontmatter) },
      name,
      mtime: { ts: mtime },
      path: filePath,
      frontmatter,
      lists: { values: lists.filter(it => it.parent === undefined) },
      tags: extractTags(frontmatter),
    },
    headers,
  }
}
