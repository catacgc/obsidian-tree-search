export { loadWasm, type WasmExports } from "./loader.ts"
export { adaptFrontmatter, adaptScanResult, adaptParseTokens, adaptBatchResult, adaptSingleResult } from "./adapter.ts"

import type { ParserProvider, FileInput } from "@mdtree/core"
import type { DvPage, ParsedTextToken } from "@mdtree/core"
import { adaptBatchResult, adaptSingleResult, adaptParseTokens } from "./adapter.ts"

export type NativeParserHandle = {
  ping: () => string
  parse_frontmatter: (content: string) => string
  scan_markdown: (content: string, file_path: string, frontmatter_body_start: number, archive_tag: string) => string
  parse_tokens: (text: string) => string
  batch_parse_chunk: (json_input: string) => string
  parse_single_file: (content: string, path: string, mtime: number, archive_tag: string) => string
}

/**
 * Load the native parser WASM module and return a handle to its exports.
 * This is the primary entry point for consumers.
 */
export async function loadNativeParser(wasmBytes: BufferSource): Promise<NativeParserHandle> {
  const { loadWasm } = await import("./loader.ts")
  const exports = await loadWasm(wasmBytes)
  return exports
}

/**
 * NativeParserProvider implements the ParserProvider interface using the WASM module.
 * The batch and single-file APIs pre-compute inline tokens for every list item
 * and frontmatter parent string within a single WASM boundary crossing.
 */
export class NativeParserProvider implements ParserProvider {
  constructor(private handle: NativeParserHandle) {}

  parseBatchChunk(files: FileInput[]): DvPage[] {
    const input = JSON.stringify(files)
    const json = this.handle.batch_parse_chunk(input)
    return adaptBatchResult(json)
  }

  parseTokens(text: string): ParsedTextToken[] {
    const json = this.handle.parse_tokens(text)
    return adaptParseTokens(json)
  }

  parseVaultFile(content: string, filePath: string, mtime: number, archiveTag: string): DvPage {
    const json = this.handle.parse_single_file(content, filePath, mtime, archiveTag)
    return adaptSingleResult(json)
  }
}

/**
 * Factory function to create a NativeParserProvider from a loaded WASM handle.
 */
export function createNativeParserProvider(handle: NativeParserHandle): ParserProvider {
  return new NativeParserProvider(handle)
}

/**
 * Process files in configurable chunks with event-loop yielding between chunks.
 * This is used by buildGraphFromScanner to avoid blocking the event loop
 * during large vault indexing while still batching WASM calls.
 *
 * @param provider - The ParserProvider to use for batch parsing
 * @param files - Array of FileInput objects to parse
 * @param chunkSize - Number of files per WASM call (default 50)
 * @returns Promise resolving to all DvPage results in input order
 */
export async function chunkedBatch(
  provider: ParserProvider,
  files: FileInput[],
  chunkSize = 50,
): Promise<DvPage[]> {
  const results: DvPage[] = []
  for (let i = 0; i < files.length; i += chunkSize) {
    const chunk = files.slice(i, i + chunkSize)
    results.push(...provider.parseBatchChunk(chunk))
    if (i + chunkSize < files.length) {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
  }
  return results
}
