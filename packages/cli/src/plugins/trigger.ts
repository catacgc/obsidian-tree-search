import type { NotesGraph, IndexSettings } from "@mdtree/core"
import type { VaultStore } from "../store/sqlite.ts"
import type { AsyncQueue } from "../util/async-queue.ts"
import { listInstalledPlugins } from "./registry.ts"
import { runPlugin } from "./runner.ts"
import { reindexFile } from "../vault/indexer.ts"

/**
 * Enqueue a run for every installed+enabled plugin into the vault's AsyncQueue.
 * Plugins share the same queue as file-watcher events, so they never run in
 * parallel with a vault reindex or with each other.
 */
export function enqueuePluginRuns(
  vaultRoot: string,
  vaultName: string,
  graph: NotesGraph,
  settings: IndexSettings,
  store: VaultStore,
  queue: AsyncQueue,
): void {
  const installed = listInstalledPlugins()
  if (installed.length === 0) return

  for (const plugin of installed) {
    queue.enqueue(async () => {
      const config = store.getPluginConfig(vaultName, plugin.namespace)
      if (!config.enabled) return

      console.log(`[${vaultName}] Running plugin: ${plugin.namespace}`)
      const outputPath = await runPlugin(plugin, config, vaultRoot)

      if (outputPath) {
        store.setPluginOutputPath(vaultName, plugin.namespace, outputPath)
        await reindexFile(outputPath, vaultRoot, graph, settings, store, vaultName)
        console.log(`[${vaultName}] Plugin ${plugin.namespace} indexed`)
      }
    })
  }
}
