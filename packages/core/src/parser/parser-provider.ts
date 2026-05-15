import type { DvPage, ParsedTextToken } from "../graph/types.ts"
import { parseVaultFile as tsParseVaultFile } from "./vault-file.ts"
import { parseTokens as tsParseTokens } from "./inline-tokens.ts"

export type FileInput = {
  path: string
  content: string
  mtime: number
  archiveTag: string
}

export interface ParserProvider {
  /** Parse a chunk of markdown files in one batch call. */
  parseBatchChunk(files: FileInput[]): DvPage[]

  /** Parse inline tokens from a text string (standalone, for canvas/frontmatter-parent). */
  parseTokens(text: string): ParsedTextToken[]

  /** Parse a single vault file (for incremental reindex). */
  parseVaultFile(content: string, filePath: string, mtime: number, archiveTag: string): DvPage
}

/**
 * TypeScript-based ParserProvider implementation.
 * Delegates to the existing TS parser functions (frontmatter.ts, list-scanner.ts, inline-tokens.ts).
 * Does NOT populate precomputedTokens — those are only set by the native parser.
 */
export class TsParserProvider implements ParserProvider {
  parseBatchChunk(files: FileInput[]): DvPage[] {
    return files.map(f => tsParseVaultFile(f.content, f.path, f.mtime, f.archiveTag))
  }

  parseTokens(text: string): ParsedTextToken[] {
    return tsParseTokens(text)
  }

  parseVaultFile(content: string, filePath: string, mtime: number, archiveTag: string): DvPage {
    return tsParseVaultFile(content, filePath, mtime, archiveTag)
  }
}

/** Factory function to create a TsParserProvider instance. */
export function createTsParserProvider(): ParserProvider {
  return new TsParserProvider()
}
