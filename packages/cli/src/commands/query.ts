import { resolve, basename } from "node:path"
import { DEFAULT_SETTINGS, NotesGraph, searchIndex, flattenIndex } from "@mdtree/core"
import type { TreeNode } from "@mdtree/core"
import { VaultStore, defaultDbPath } from "../store/sqlite.ts"

export type QueryOptions = {
  dirs: string[]
  queryStr: string
  limit: number
  out?: string
  json: boolean
}

export async function runQuery(opts: QueryOptions): Promise<void> {
  if (opts.out && opts.dirs.length > 1) {
    console.error("[mdtree] --out cannot be used with multiple --dir arguments")
    process.exit(1)
  }

  const allResults: TreeNode[] = []

  for (const dir of opts.dirs) {
    const vaultRoot = resolve(dir)
    const vaultName = basename(vaultRoot)
    const dbPath = opts.out ?? defaultDbPath(vaultName)

    const store = new VaultStore(dbPath)
    const graph = new NotesGraph()

    // When --out is given we load every vault stored in that DB file;
    // otherwise we load only the vault whose name matches the directory.
    const vaultNames = opts.out ? store.listVaults() : [vaultName]
    for (const name of vaultNames) {
      store.loadIntoGraph(name, graph)
    }
    store.close()

    const results = searchIndex(graph, opts.queryStr, DEFAULT_SETTINGS.searchSeparator)
    const flat = flattenIndex(results)
    allResults.push(...flat)
  }

  const limited = allResults.slice(0, opts.limit)

  if (opts.json) {
    process.stdout.write(JSON.stringify(limited, null, 2) + "\n")
  } else {
    for (const item of limited) {
      process.stdout.write(item.node.searchKey + "\n")
    }
  }
}
