import { NotesGraph } from "./graph.ts"
import { indexSinglePage, DEFAULT_SETTINGS, type IndexSettings } from "./indexer.ts"
import { parseVaultFile } from "../parser/vault-file.ts"
import { parseCanvasData, type CanvasData } from "../parser/canvas.ts"
import type { VaultScanner } from "./scanner.ts"

function extname(path: string): string {
  const dot = path.lastIndexOf(".")
  const slash = path.lastIndexOf("/")
  return dot > slash ? path.slice(dot).toLowerCase() : ""
}

function basename(path: string, stripExt?: string): string {
  const name = path.split("/").pop() ?? path
  if (stripExt && name.endsWith(stripExt)) return name.slice(0, -stripExt.length)
  return name
}

async function indexScannedFile(
  relPath: string,
  content: string,
  mtime: number,
  graph: NotesGraph,
  settings: IndexSettings,
): Promise<void> {
  const ext = extname(relPath)
  try {
    if (ext === ".md") {
      const dvPage = parseVaultFile(content, relPath, mtime, settings.archiveTag)
      indexSinglePage(dvPage, graph, settings)
    } else if (ext === ".canvas") {
      let canvasData: CanvasData
      try {
        canvasData = JSON.parse(content) as CanvasData
      } catch {
        console.warn(`[mdtree] Failed to parse canvas: ${relPath}`)
        return
      }
      const name = basename(relPath, ".canvas")
      parseCanvasData(relPath, name, canvasData, graph)
    } else {
      const name = basename(relPath)
      const extension = ext.slice(1)
      graph.addAttachmentNode(name, extension, relPath, mtime)
    }
  } catch (err) {
    console.warn(`[mdtree] Error indexing ${relPath}:`, err)
  }
}

const BATCH_SIZE = 10

export async function buildGraphFromScanner(
  scanner: VaultScanner,
  settings: IndexSettings = DEFAULT_SETTINGS,
): Promise<NotesGraph> {
  const graph = new NotesGraph()
  const { files, folders } = await scanner.walkVault()

  for (const folder of folders) {
    const location = {
      path: folder.path,
      position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } },
    }
    graph.createFolderNode(folder.path, folder.name, location)
  }

  for (let i = 0; i < files.length; i++) {
    if (i % BATCH_SIZE === 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
    const file = files[i]
    const { content, mtime } = await scanner.readFile(file.path)
    await indexScannedFile(file.path, content, mtime, graph, settings)
  }

  return graph
}

export async function reindexFileInGraph(
  relPath: string,
  graph: NotesGraph,
  scanner: VaultScanner,
  settings: IndexSettings,
): Promise<void> {
  graph.removeByPath(relPath)
  const { content, mtime } = await scanner.readFile(relPath)
  await indexScannedFile(relPath, content, mtime, graph, settings)
}
