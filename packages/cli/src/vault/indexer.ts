import { relative, join, dirname } from "node:path"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import {
  NotesGraph,
  buildGraphFromScanner,
  reindexFileInGraph,
  type IndexSettings,
  DEFAULT_SETTINGS,
  type ParseCacheEntry,
  serializeCache,
  deserializeCache,
} from "@mdtree/core"
import { NodeVaultScanner } from "./node-scanner.ts"
import { getPeriodicResolver } from "./periodic-config.ts"
import type { VaultStore } from "../store/sqlite.ts"

// Attach the vault's daily/weekly-note date resolver unless the caller already
// supplied one, so every indexing path ages periodic notes from their filename.
async function withPeriodicDate(vaultRoot: string, settings: IndexSettings): Promise<IndexSettings> {
  if (settings.periodicDate) return settings
  return { ...settings, periodicDate: await getPeriodicResolver(vaultRoot) }
}

function cacheFilePath(vaultRoot: string): string {
  return join(vaultRoot, ".mdtree", "cache.json")
}

async function loadCacheFromFile(cacheFile: string): Promise<Map<string, ParseCacheEntry>> {
  try {
    const json = await readFile(cacheFile, "utf-8")
    return deserializeCache(json)
  } catch {
    return new Map()
  }
}

async function saveCacheToFile(cacheFile: string, cache: Map<string, ParseCacheEntry>): Promise<void> {
  try {
    await mkdir(dirname(cacheFile), { recursive: true })
    await writeFile(cacheFile, serializeCache(cache), "utf-8")
  } catch (err) {
    console.warn("[mdtree] Failed to save parse cache:", err)
  }
}

export async function buildGraph(
  vaultRoot: string,
  settings: IndexSettings = DEFAULT_SETTINGS,
): Promise<{ graph: NotesGraph; cache: Map<string, ParseCacheEntry> }> {
  const cacheFile = cacheFilePath(vaultRoot)
  const cache = await loadCacheFromFile(cacheFile)
  const resolvedSettings = await withPeriodicDate(vaultRoot, settings)
  const graph = await buildGraphFromScanner(new NodeVaultScanner(vaultRoot), resolvedSettings, cache)
  await saveCacheToFile(cacheFile, cache)
  return { graph, cache }
}

export async function reindexFile(
  absPath: string,
  vaultRoot: string,
  graph: NotesGraph,
  settings: IndexSettings,
  parseCache?: Map<string, ParseCacheEntry>,
  store?: VaultStore,
  vault?: string,
): Promise<void> {
  const relPath = relative(vaultRoot, absPath)

  const resolvedSettings = await withPeriodicDate(vaultRoot, settings)
  await reindexFileInGraph(relPath, graph, new NodeVaultScanner(vaultRoot), resolvedSettings, parseCache)

  if (store && vault) {
    store.deleteByPath(vault, relPath)

    const newNodeKeys = graph.filterNodes(
      (_, attrs) => attrs.location.path === relPath,
    )
    const nodeRows = newNodeKeys.map(key => ({
      key,
      node: graph.getNodeAttributes(key),
    }))
    store.insertNodes(vault, nodeRows)

    const edgeRows: Parameters<VaultStore["insertEdges"]>[1] = []
    for (const key of newNodeKeys) {
      for (const edge of graph.outboundEdgeEntries(key)) {
        edgeRows.push({
          from: edge.source,
          to: edge.target,
          type: edge.attributes.type,
          srcPath: edge.attributes.location.path,
          mtime: edge.attributes.mtime,
          location: edge.attributes.location,
        })
      }
    }
    store.insertEdges(vault, edgeRows)
  }
}
