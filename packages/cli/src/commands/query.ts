import { resolve, basename } from "node:path"
import { DEFAULT_SETTINGS, NotesGraph, searchIndex, flattenIndex, parseQuery, partitionArchived, reverseMarkdownParsing } from "@mdtree/core"
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
  let totalArchived = 0

  const matchExprs = parseQuery(opts.queryStr, DEFAULT_SETTINGS.searchSeparator)

  for (const dir of opts.dirs) {
    const vaultRoot = resolve(dir)
    const vaultName = basename(vaultRoot)
    const dbPath = opts.out ?? defaultDbPath(vaultName)

    const store = new VaultStore(dbPath)
    const graph = new NotesGraph()
    store.loadIntoGraph(vaultName, graph)
    store.close()

    const results = searchIndex(graph, opts.queryStr, DEFAULT_SETTINGS.searchSeparator)
    const { visible, archivedCount: vaultArchived } = partitionArchived(results)
    const flat = flattenIndex(visible, 0, matchExprs)
    allResults.push(...flat)
    totalArchived += vaultArchived
  }

  const limited = allResults.slice(0, opts.limit)

  if (opts.json) {
    const output = { results: limited, archivedCount: totalArchived }
    process.stdout.write(JSON.stringify(output, null, 2) + "\n")
  } else {
    for (const item of limited) {
      const indent = "  ".repeat(item.indent)
      const label = reverseMarkdownParsing(item.node)
      process.stdout.write(indent + label + "\n")
    }
    if (totalArchived > 0) {
      process.stdout.write(`Archive (${totalArchived} items)\n`)
    }
  }
}
