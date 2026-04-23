import { relative } from "node:path"
import {
  NotesGraph,
  buildGraphFromScanner,
  reindexFileInGraph,
  type IndexSettings,
  DEFAULT_SETTINGS,
} from "@mdtree/core"
import { NodeVaultScanner } from "./node-scanner.ts"
import type { VaultStore } from "../store/sqlite.ts"

// ── Build full graph from vault ───────────────────────────────────────────────

export async function buildGraph(
  vaultRoot: string,
  settings: IndexSettings = DEFAULT_SETTINGS,
): Promise<NotesGraph> {
  return buildGraphFromScanner(new NodeVaultScanner(vaultRoot), settings)
}

// ── Incremental re-index of a single changed file ────────────────────────────

export async function reindexFile(
  absPath: string,
  vaultRoot: string,
  graph: NotesGraph,
  settings: IndexSettings,
  store?: VaultStore,
  vault?: string,
): Promise<void> {
  const relPath = relative(vaultRoot, absPath)

  await reindexFileInGraph(relPath, graph, new NodeVaultScanner(vaultRoot), settings)

  // Persist new nodes/edges to SQLite
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
