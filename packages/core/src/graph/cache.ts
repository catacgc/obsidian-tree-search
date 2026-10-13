import type { ParseCacheEntry } from "./builder.ts"

// Bump `version` when parsing changes, so cached parses of unchanged files are redone.
type SerializedCache = {
  version: 4
  entries: Record<string, ParseCacheEntry>
}

export function serializeCache(cache: Map<string, ParseCacheEntry>): string {
  const entries: Record<string, ParseCacheEntry> = {}
  for (const [path, entry] of cache) {
    entries[path] = entry
  }
  return JSON.stringify({ version: 4, entries } satisfies SerializedCache)
}

export function deserializeCache(json: string): Map<string, ParseCacheEntry> {
  try {
    const parsed = JSON.parse(json) as SerializedCache
    if (!parsed || parsed.version !== 4 || typeof parsed.entries !== "object") {
      return new Map()
    }
    return new Map(Object.entries(parsed.entries))
  } catch {
    return new Map()
  }
}
