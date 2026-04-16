import { resolve, basename } from "node:path"
import { DEFAULT_SETTINGS } from "@mdtree/core"
import { reindexFile } from "../vault/indexer.ts"
import { watchVault } from "../vault/watcher.ts"
import { VaultStore, defaultDbPath } from "../store/sqlite.ts"
import { startServer, type VaultIndex } from "../server/server.ts"
import { loadOrBuild } from "./watch.ts"
import { AsyncQueue } from "../util/async-queue.ts"
import { enqueuePluginRuns } from "../plugins/trigger.ts"

export type ServeOptions = {
  vaults: string[]          // one or more vault paths
  out?: string              // shared SQLite path (or per-vault auto if omitted)
  port?: number             // if set, TCP; else Unix socket
  fresh?: boolean           // force rebuild ignoring cached index
}

export async function runServe(opts: ServeOptions): Promise<void> {
  if (opts.vaults.length === 0) {
    console.error("[mdtree] No vaults specified.")
    process.exit(1)
  }

  const stoppers: (() => void)[] = []

  for (const rawVault of opts.vaults) {
    const vaultRoot = resolve(rawVault)
    const vaultName = basename(vaultRoot)
    const dbPath = opts.out ?? defaultDbPath(vaultName)

    const { graph, store } = await loadOrBuild(vaultRoot, vaultName, dbPath, opts.fresh)

    const vaultIndex: VaultIndex = {
      graph,
      settings: DEFAULT_SETTINGS,
      vaultName,
    }

    // Start HTTP server for this vault
    const server = startServer(vaultIndex, {
      port: opts.vaults.length === 1 ? opts.port : undefined,
      // Multi-vault: each gets its own socket regardless of --port
      socketPath:
        opts.vaults.length > 1 || !opts.port
          ? `/tmp/mdtree-${vaultName}.sock`
          : undefined,
    })

    // Run plugins after initial index, then watch for file changes
    const queue = new AsyncQueue()
    enqueuePluginRuns(vaultRoot, vaultName, graph, DEFAULT_SETTINGS, store, queue)
    const stopWatch = watchVault(vaultRoot, event => {
      queue.enqueue(async () => {
        if (event.type === "unlink") {
          const relPath = event.path.slice(vaultRoot.length + 1)
          graph.removeByPath(relPath)
          store.deleteByPath(vaultName, relPath)
          console.log(`[${vaultName}] Removed: ${relPath}`)
        } else {
          console.log(`[${vaultName}] Re-indexing: ${event.path.slice(vaultRoot.length + 1)}`)
          await reindexFile(event.path, vaultRoot, graph, DEFAULT_SETTINGS, store, vaultName)
        }
      })
    })

    stoppers.push(() => {
      stopWatch()
      server.stop()
      store.close()
    })
  }

  console.log(`[mdtree] Serving ${opts.vaults.length} vault(s). Press Ctrl+C to stop.`)

  await waitForSignal()
  for (const stop of stoppers) stop()
}

function waitForSignal(): Promise<void> {
  return new Promise(resolve => {
    process.once("SIGINT", resolve)
    process.once("SIGTERM", resolve)
  })
}
