import { readFile, stat } from "node:fs/promises"
import { extname, basename, relative } from "node:path"
import {
  NotesGraph,
  parseVaultFile,
  parseCanvasData,
  indexSinglePage,
  type IndexSettings,
  DEFAULT_SETTINGS,
} from "@mdtree/core"
import type { CanvasData } from "@mdtree/core"
import { walkVault } from "./walker.ts"
import type { VaultStore } from "../store/sqlite.ts"

// ── Parse a single file into the graph ───────────────────────────────────────

export async function indexFile(
  absPath: string,
  vaultRoot: string,
  graph: NotesGraph,
  settings: IndexSettings,
): Promise<void> {
  const relPath = relative(vaultRoot, absPath)
  const ext = extname(absPath).toLowerCase()

  try {
    const content = await readFile(absPath, "utf-8")

    if (ext === ".md") {

      const s = await stat(absPath)
      const dvPage = parseVaultFile(content, relPath, s.mtimeMs, settings.archiveTag)
      indexSinglePage(dvPage, graph, settings)
    } else if (ext === ".canvas") {
      let canvasData: CanvasData
      try {
        canvasData = JSON.parse(content) as CanvasData
      } catch {
        console.warn(`[mdtree] Failed to parse canvas: ${relPath}`)
        return
      }
      const name = basename(absPath, ".canvas")
      parseCanvasData(relPath, name, canvasData, graph)
    } else {
      // attachment

      const s = await stat(absPath)
      const name = basename(absPath)
      const extension = ext.slice(1)
      graph.addAttachmentNode(name, extension, relPath, s.mtimeMs)
    }
  } catch (err) {
    console.warn(`[mdtree] Error indexing ${relPath}:`, err)
  }
}

// ── Build full graph from vault ───────────────────────────────────────────────

export async function buildGraph(
  vaultRoot: string,
  settings: IndexSettings = DEFAULT_SETTINGS,
): Promise<NotesGraph> {
  const graph = new NotesGraph()
  const { files, folders } = await walkVault(vaultRoot)

  // Index folders first so folder nodes exist when pages are added
  for (const folder of folders) {
    const location = {
      path: folder.relativePath,
      position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } },
    }
    graph.createFolderNode(folder.relativePath, folder.name, location)
  }

  // Index files
  for (const file of files) {
    await indexFile(file.path, vaultRoot, graph, settings)
  }

  return graph
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

  // Remove old data from memory and SQLite
  graph.removeByPath(relPath)
  if (store && vault) {
    store.deleteByPath(vault, relPath)
  }

  // Re-index
  await indexFile(absPath, vaultRoot, graph, settings)

  // Persist new nodes/edges to SQLite
  if (store && vault) {
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
