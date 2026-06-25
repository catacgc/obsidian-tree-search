import { NotesGraph } from "./graph.ts"
import { indexSinglePage, DEFAULT_SETTINGS, type IndexSettings } from "./indexer.ts"
import { parseVaultFile } from "../parser/vault-file.ts"
import { parseCanvasData, type CanvasData } from "../parser/canvas.ts"
import type { VaultScanner } from "./scanner.ts"
import type { DvPage } from "./types.ts"

export type ParseCacheEntry = {
  page: DvPage
  mtime: number
}

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

const READ_BATCH = 64

export async function buildGraphFromScanner(
  scanner: VaultScanner,
  settings: IndexSettings = DEFAULT_SETTINGS,
  parseCache?: Map<string, ParseCacheEntry>,
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

  const mdNeedRead: typeof files[number][] = []
  const canvasFiles: typeof files[number][] = []

  for (const file of files) {
    const ext = extname(file.path)
    if (ext === ".md") {
      if (parseCache) {
        const cached = parseCache.get(file.path)
        if (cached && cached.mtime === file.mtime) {
          try {
            indexSinglePage(cached.page, graph, settings)
            continue
          } catch (err) {
            console.warn(`[mdtree] Error indexing cached ${file.path}:`, err)
          }
        }
      }
      mdNeedRead.push(file)
    } else if (ext === ".canvas") {
      canvasFiles.push(file)
    } else {
      const name = basename(file.path)
      const extension = ext.slice(1)
      graph.addAttachmentNode(name, extension, file.path, file.mtime)
    }
  }

  for (let i = 0; i < mdNeedRead.length; i += READ_BATCH) {
    const batch = mdNeedRead.slice(i, i + READ_BATCH)
    const results = await Promise.all(
      batch.map(f => scanner.readFile(f.path).catch(() => null))
    )
    for (let j = 0; j < batch.length; j++) {
      const result = results[j]
      if (!result) continue
      const file = batch[j]
      const { content, mtime } = result
      try {
        const dvPage = parseVaultFile(content, file.path, mtime, settings.archiveTag)
        if (parseCache) parseCache.set(file.path, { page: dvPage, mtime })
        indexSinglePage(dvPage, graph, settings)
      } catch (err) {
        console.warn(`[mdtree] Error indexing ${file.path}:`, err)
      }
    }
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }

  if (canvasFiles.length > 0) {
    const canvasResults = await Promise.all(
      canvasFiles.map(f => scanner.readFile(f.path).catch(() => null))
    )
    for (let i = 0; i < canvasFiles.length; i++) {
      const result = canvasResults[i]
      if (!result) continue
      await indexScannedFile(canvasFiles[i].path, result.content, result.mtime, graph, settings)
    }
  }

  if (parseCache) {
    const currentPaths = new Set(files.map(f => f.path))
    let deletedCount = 0
    for (const cachedPath of Array.from(parseCache.keys())) {
      if (!currentPaths.has(cachedPath)) {
        parseCache.delete(cachedPath)
        deletedCount++
      }
    }
    if (deletedCount > 0) {
      console.debug(`[mdtree] Cache cleanup: removed ${deletedCount} stale entries`)
    }
    console.debug(`[mdtree] Cache size: ${parseCache.size} entries`)
  }

  return graph
}

export async function reindexFileInGraph(
  relPath: string,
  graph: NotesGraph,
  scanner: VaultScanner,
  settings: IndexSettings,
  parseCache?: Map<string, ParseCacheEntry>,
): Promise<void> {
  graph.removeByPath(relPath)
  const { content, mtime } = await scanner.readFile(relPath)

  if (extname(relPath) === ".md") {
    const dvPage = parseVaultFile(content, relPath, mtime, settings.archiveTag)
    if (parseCache) parseCache.set(relPath, { page: dvPage, mtime })
    indexSinglePage(dvPage, graph, settings)
  } else {
    await indexScannedFile(relPath, content, mtime, graph, settings)
  }
}
