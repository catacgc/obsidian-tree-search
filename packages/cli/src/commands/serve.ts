import { resolve, basename } from "node:path"
import { DEFAULT_SETTINGS } from "@mdtree/core"
import { reindexFile } from "../vault/indexer.ts"
import { watchVault } from "../vault/watcher.ts"
import { VaultStore, defaultDbPath } from "../store/sqlite.ts"
import { startServer, type VaultIndex } from "../server/server.ts"
import { loadOrBuild } from "./watch.ts"
import { getDailyNotePath } from "../vault/periodic-config.ts"
import { AsyncQueue } from "../util/async-queue.ts"
import { enqueuePluginRuns } from "../plugins/trigger.ts"

export type ServeOptions = {
  dirs: string[]
  out?: string
  port?: number
  fresh?: boolean
}

export async function runServe(opts: ServeOptions): Promise<void> {
  if (opts.dirs.length === 0) {
    console.error("[mdtree] No directories specified.")
    process.exit(1)
  }

  if (opts.out && opts.dirs.length > 1) {
    console.error("[mdtree] --out cannot be used with multiple --dir arguments")
    process.exit(1)
  }

  const stoppers: (() => void)[] = []

  for (const rawDir of opts.dirs) {
    const vaultRoot = resolve(rawDir)
    const vaultName = basename(vaultRoot)
    const dbPath = opts.out ?? defaultDbPath(vaultName)

    const { graph, store, cache } = await loadOrBuild(vaultRoot, vaultName, dbPath, opts.fresh)

    const vaultIndex: VaultIndex = {
      graph,
      settings: DEFAULT_SETTINGS,
      vaultName,
      dailyNote: await getDailyNotePath(vaultRoot),
    }

    const server = startServer(vaultIndex, {
      port: opts.dirs.length === 1 ? opts.port : undefined,
      socketPath:
        opts.dirs.length > 1 || !opts.port
          ? `/tmp/mdtree-${vaultName}.sock`
          : undefined,
    })

    const queue = new AsyncQueue()
    enqueuePluginRuns(vaultRoot, vaultName, graph, DEFAULT_SETTINGS, store, queue, cache)
    const stopWatch = watchVault(vaultRoot, event => {
      queue.enqueue(async () => {
        if (event.type === "unlink") {
          const relPath = event.path.slice(vaultRoot.length + 1)
          graph.removeByPath(relPath)
          store.deleteByPath(vaultName, relPath)
          console.log(`[${vaultName}] Removed: ${relPath}`)
        } else {
          console.log(`[${vaultName}] Re-indexing: ${event.path.slice(vaultRoot.length + 1)}`)
          await reindexFile(event.path, vaultRoot, graph, DEFAULT_SETTINGS, cache, store, vaultName)
        }
      })
    })

    stoppers.push(() => {
      stopWatch()
      server.stop()
      store.close()
    })
  }

  console.log(`[mdtree] Serving ${opts.dirs.length} vault(s). Press Ctrl+C to stop.`)

  await waitForSignal()
  for (const stop of stoppers) stop()
}

function waitForSignal(): Promise<void> {
  return new Promise(resolve => {
    process.once("SIGINT", resolve)
    process.once("SIGTERM", resolve)
  })
}
