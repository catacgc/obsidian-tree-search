import { describe, it, expect } from "bun:test"
import { createTsParserProvider } from "../parser/parser-provider.ts"
import { parseTokens } from "../parser/inline-tokens.ts"
import { parseVaultFile } from "../parser/vault-file.ts"

describe("TsParserProvider", () => {
  const provider = createTsParserProvider()

  describe("parseTokens", () => {
    it("delegates to inline-tokens.ts parseTokens", () => {
      const text = "[[Link]]"
      const expected = parseTokens(text)
      const result = provider.parseTokens(text)
      expect(result).toEqual(expected)
    })

    it("handles text with multiple token types", () => {
      const text = "[[Page]] hello [md link](http://example.com)"
      const expected = parseTokens(text)
      const result = provider.parseTokens(text)
      expect(result).toEqual(expected)
    })

    it("handles meta-action triples", () => {
      const text = "task (meta-action-name::Open)(meta-action-url::https://x.com)"
      const expected = parseTokens(text)
      const result = provider.parseTokens(text)
      expect(result).toEqual(expected)
    })
  })

  describe("parseVaultFile", () => {
    it("delegates to vault-file.ts parseVaultFile", () => {
      const content = "---\naliases:\n  - Alias1\n---\n\n# Header\n\n- [[Link]] text"
      const path = "test/note.md"
      const mtime = 1700000000000
      const archiveTag = "archive"

      const expected = parseVaultFile(content, path, mtime, archiveTag)
      const result = provider.parseVaultFile(content, path, mtime, archiveTag)
      expect(result).toEqual(expected)
    })

    it("handles file with no frontmatter", () => {
      const content = "# Just a header\n\n- [[Link]]"
      const path = "simple.md"
      const mtime = 1700000000000

      const expected = parseVaultFile(content, path, mtime, "archive")
      const result = provider.parseVaultFile(content, path, mtime, "archive")
      expect(result).toEqual(expected)
    })
  })

  describe("parseBatchChunk", () => {
    it("processes multiple files and returns matching results", () => {
      const files = [
        {
          path: "file1.md",
          content: "---\ntags:\n  - work\n---\n\n- [[A]] item",
          mtime: 1700000000000,
          archiveTag: "archive",
        },
        {
          path: "folder/file2.md",
          content: "# Title\n\n- [[B]] other item",
          mtime: 1700000001000,
          archiveTag: "archive",
        },
      ]

      const result = provider.parseBatchChunk(files)
      expect(result).toHaveLength(2)

      // Verify each matches individual parseVaultFile call
      for (const file of files) {
        const expected = parseVaultFile(file.content, file.path, file.mtime, file.archiveTag)
        const actual = result.find(p => p.file.path === file.path)
        expect(actual).toEqual(expected)
      }
    })

    it("returns empty array for empty input", () => {
      const result = provider.parseBatchChunk([])
      expect(result).toEqual([])
    })
  })
})
