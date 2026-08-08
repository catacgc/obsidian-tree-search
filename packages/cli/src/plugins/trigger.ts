import type { NotesGraph, IndexSettings, ParseCacheEntry } from "@mdtree/core"
import type { VaultStore } from "../store/sqlite.ts"
import type { AsyncQueue } from "../util/async-queue.ts"
import type { InstalledPlugin } from "./types.ts"
import { listInstalledPlugins } from "./registry.ts"
import { runPlugin } from "./runner.ts"
import { reindexFile } from "../vault/indexer.ts"

/**
 * Runs a single plugin (if enabled for this vault) and reindexes its output into
 * the graph and store. Returns true if the plugin produced indexed output.
 */
export async function runPluginAndIndex(
  plugin: InstalledPlugin,
  vaultRoot: string,
  vaultName: string,
  graph: NotesGraph,
  settings: IndexSettings,
  store: VaultStore,
  cache?: Map<string, ParseCacheEntry>,
): Promise<boolean> {
  const config = store.getPluginConfig(vaultName, plugin.namespace)
  if (!config.enabled) return false

  console.log(`[${vaultName}] Running plugin: ${plugin.namespace}`)
  const outputPath = await runPlugin(plugin, config, vaultRoot)

  if (outputPath) {
    store.setPluginOutputPath(vaultName, plugin.namespace, outputPath)
    await reindexFile(outputPath, vaultRoot, graph, settings, cache, store, vaultName)
    console.log(`[${vaultName}] Plugin ${plugin.namespace} indexed → ${outputPath}`)
    return true
  }
  return false
}

export function enqueuePluginRuns(
  vaultRoot: string,
  vaultName: string,
  graph: NotesGraph,
  settings: IndexSettings,
  store: VaultStore,
  queue: AsyncQueue,
  cache?: Map<string, ParseCacheEntry>,
): void {
  const installed = listInstalledPlugins()
  if (installed.length === 0) return

  for (const plugin of installed) {
    queue.enqueue(() =>
      runPluginAndIndex(plugin, vaultRoot, vaultName, graph, settings, store, cache),
    )
  }
}
