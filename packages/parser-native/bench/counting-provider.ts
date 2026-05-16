/**
 * CountingProviderWrapper delegates to an inner ParserProvider
 * while counting method invocations for boundary crossing validation.
 */

import type { ParserProvider, FileInput, DvPage, ParsedTextToken } from "@mdtree/core"

export class CountingProviderWrapper implements ParserProvider {
  batchChunkCalls = 0
  parseTokensCalls = 0
  parseVaultFileCalls = 0
  totalFilesInBatches = 0

  constructor(private inner: ParserProvider) {}

  parseBatchChunk(files: FileInput[]): DvPage[] {
    this.batchChunkCalls++
    this.totalFilesInBatches += files.length
    return this.inner.parseBatchChunk(files)
  }

  parseTokens(text: string): ParsedTextToken[] {
    this.parseTokensCalls++
    return this.inner.parseTokens(text)
  }

  parseVaultFile(content: string, filePath: string, mtime: number, archiveTag: string): DvPage {
    this.parseVaultFileCalls++
    return this.inner.parseVaultFile(content, filePath, mtime, archiveTag)
  }

  reset(): void {
    this.batchChunkCalls = 0
    this.parseTokensCalls = 0
    this.parseVaultFileCalls = 0
    this.totalFilesInBatches = 0
  }

  getCounts() {
    return {
      batchChunkCalls: this.batchChunkCalls,
      parseTokensCalls: this.parseTokensCalls,
      parseVaultFileCalls: this.parseVaultFileCalls,
      totalFilesInBatches: this.totalFilesInBatches,
    }
  }
}
