import { resolve, basename } from "node:path"
import { DEFAULT_SETTINGS } from "@mdtree/core"
import { buildGraph } from "../vault/indexer.ts"
import { VaultStore, defaultDbPath } from "../store/sqlite.ts"

export type IndexOptions = {
  dirs: string[]
  out?: string
}

export async function runIndex(opts: IndexOptions): Promise<void> {
  if (opts.out && opts.dirs.length > 1) {
    console.error("[mdtree] --out cannot be used with multiple --dir arguments")
    process.exit(1)
  }

  for (const dir of opts.dirs) {
    const vaultRoot = resolve(dir)
    const vaultName = basename(vaultRoot)
    const dbPath = opts.out ?? defaultDbPath(vaultName)

    console.log(`[mdtree] Indexing vault: ${vaultRoot}`)
    const start = Date.now()

    const { graph } = await buildGraph(vaultRoot, DEFAULT_SETTINGS)
    const nodeCount = graph.order
    const edgeCount = graph.size
    console.log(`[mdtree] Built graph: ${nodeCount} nodes, ${edgeCount} edges (${Date.now() - start}ms)`)

    console.log(`[mdtree] Writing index to: ${dbPath}`)
    const store = new VaultStore(dbPath)
    store.saveGraph(vaultName, graph)
    store.close()

    console.log(`[mdtree] Done.`)
  }
}
