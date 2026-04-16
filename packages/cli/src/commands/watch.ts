import { resolve, basename } from "node:path"
import { DEFAULT_SETTINGS, NotesGraph } from "@mdtree/core"
import { buildGraph, reindexFile } from "../vault/indexer.ts"
import { watchVault } from "../vault/watcher.ts"
import { VaultStore, defaultDbPath } from "../store/sqlite.ts"
import { AsyncQueue } from "../util/async-queue.ts"
import { enqueuePluginRuns } from "../plugins/trigger.ts"

export type WatchOptions = {
  vault: string
  out?: string
  fresh?: boolean
}

export async function runWatch(opts: WatchOptions): Promise<void> {
  const vaultRoot = resolve(opts.vault)
  const vaultName = basename(vaultRoot)
  const dbPath = opts.out ?? defaultDbPath(vaultName)

  const { graph, store } = await loadOrBuild(vaultRoot, vaultName, dbPath, opts.fresh)

  console.log(`[mdtree] Watching ${vaultRoot} ...`)

  const queue = new AsyncQueue()
  enqueuePluginRuns(vaultRoot, vaultName, graph, DEFAULT_SETTINGS, store, queue)
  const stop = watchVault(vaultRoot, event => {
    queue.enqueue(async () => {
      if (event.type === "unlink") {
        const relPath = event.path.slice(vaultRoot.length + 1)
        graph.removeByPath(relPath)
        store.deleteByPath(vaultName, relPath)
        console.log(`[mdtree] Removed: ${relPath}`)
      } else {
        console.log(`[mdtree] Re-indexing: ${event.path.slice(vaultRoot.length + 1)}`)
        await reindexFile(event.path, vaultRoot, graph, DEFAULT_SETTINGS, store, vaultName)
      }
    })
  })

  // Keep alive until SIGINT
  await waitForSignal()
  stop()
  store.close()
}

// Stale threshold: warn (but still use cache) if older than 24 h
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000

export async function loadOrBuild(
  vaultRoot: string,
  vaultName: string,
  dbPath: string,
  fresh = false,
): Promise<{ graph: NotesGraph; store: VaultStore }> {
  const store = new VaultStore(dbPath)

  if (!fresh && store.hasData(vaultName)) {
    const lastIndexed = store.lastIndexed(vaultName)
    if (lastIndexed > 0) {
      const ageMs = Date.now() - lastIndexed
      if (ageMs > STALE_THRESHOLD_MS) {
        const hours = Math.round(ageMs / 3_600_000)
        console.warn(`[mdtree] Cache is ${hours}h old — run with --fresh to rebuild`)
      }
    }
    console.log(`[mdtree] Loading from cache: ${dbPath}`)
    const start = Date.now()
    const graph = new NotesGraph()
    store.loadIntoGraph(vaultName, graph)
    console.log(`[mdtree] Loaded ${graph.order} nodes in ${Date.now() - start}ms`)
    return { graph, store }
  }

  console.log(`[mdtree] Building graph for: ${vaultRoot}`)
  const start = Date.now()
  const graph = await buildGraph(vaultRoot, DEFAULT_SETTINGS)
  console.log(`[mdtree] Built ${graph.order} nodes in ${Date.now() - start}ms`)
  store.saveGraph(vaultName, graph)
  return { graph, store }
}

function waitForSignal(): Promise<void> {
  return new Promise(resolve => {
    process.once("SIGINT", resolve)
    process.once("SIGTERM", resolve)
  })
}

