import { describe, it, expect } from "bun:test"
import { serializeCache, deserializeCache } from "../graph/cache.ts"
import type { ParseCacheEntry } from "../graph/builder.ts"
import { parseVaultFile } from "../parser/vault-file.ts"

function makeEntry(content: string, path: string, mtime: number): ParseCacheEntry {
  return { page: parseVaultFile(content, path, mtime), mtime }
}

describe("serializeCache / deserializeCache", () => {
  it("round-trips a populated cache", () => {
    const cache = new Map<string, ParseCacheEntry>([
      ["folder/note.md", makeEntry("- [[Link]] text", "folder/note.md", 1700000000000)],
      ["other.md", makeEntry("# Title", "other.md", 1700000001000)],
    ])

    const json = serializeCache(cache)
    const restored = deserializeCache(json)

    expect(restored.size).toBe(2)
    expect(restored.get("folder/note.md")?.mtime).toBe(1700000000000)
    expect(restored.get("other.md")?.mtime).toBe(1700000001000)
    expect(restored.get("folder/note.md")?.page.file.path).toBe("folder/note.md")
  })

  it("round-trips an empty cache", () => {
    const json = serializeCache(new Map())
    const restored = deserializeCache(json)
    expect(restored.size).toBe(0)
  })

  it("returns empty Map for corrupted JSON", () => {
    expect(deserializeCache("not valid json{{{").size).toBe(0)
  })

  it("returns empty Map for unknown version", () => {
    expect(deserializeCache(JSON.stringify({ version: 99, entries: {} })).size).toBe(0)
  })

  it("returns empty Map for empty string", () => {
    expect(deserializeCache("").size).toBe(0)
  })
})
