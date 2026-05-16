import { NotesGraph } from "./graph.ts"
import { indexSinglePage, DEFAULT_SETTINGS, type IndexSettings } from "./indexer.ts"
import { parseVaultFile } from "../parser/vault-file.ts"
import { parseCanvasData, type CanvasData } from "../parser/canvas.ts"
import type { VaultScanner } from "./scanner.ts"
import type { ParserProvider } from "../parser/parser-provider.ts"
import type { ParsedTextToken } from "./types.ts"

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
  parseTokensFn?: (text: string) => ParsedTextToken[],
): Promise<void> {
  const ext = extname(relPath)
  try {
    if (ext === ".md") {
      const dvPage = parseVaultFile(content, relPath, mtime, settings.archiveTag)
      indexSinglePage(dvPage, graph, settings, parseTokensFn)
    } else if (ext === ".canvas") {
      let canvasData: CanvasData
      try {
        canvasData = JSON.parse(content) as CanvasData
      } catch {
        console.warn(`[mdtree] Failed to parse canvas: ${relPath}`)
        return
      }
      const name = basename(relPath, ".canvas")
      parseCanvasData(relPath, name, canvasData, graph, parseTokensFn)
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
  provider?: ParserProvider,
  chunkSize = 50,
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

  if (provider) {
    // BATCH PATH: separate .md files from others
    const mdFiles: { path: string; content: string; mtime: number }[] = []
    const otherFiles: typeof files[number][] = []

    for (const file of files) {
      const ext = extname(file.path)
      if (ext === ".md") {
        const { content, mtime } = await scanner.readFile(file.path)
        mdFiles.push({ path: file.path, content, mtime })
      } else {
        otherFiles.push(file)
      }
    }

    // Process .md files in chunks via provider.parseBatchChunk
    for (let i = 0; i < mdFiles.length; i += chunkSize) {
      const chunk = mdFiles.slice(i, i + chunkSize)
      const input = chunk.map(f => ({
        path: f.path,
        content: f.content,
        mtime: f.mtime,
        archiveTag: settings.archiveTag,
      }))

      let pages: ReturnType<ParserProvider["parseBatchChunk"]>
      try {
        pages = provider.parseBatchChunk(input)
      } catch (batchErr) {
        // Batch failed — retry each file individually for resilience
        console.warn(`[mdtree] Batch parse failed for chunk starting at index ${i}, retrying individually:`, batchErr)
        for (const file of chunk) {
          try {
            const page = provider.parseVaultFile(file.content, file.path, file.mtime, settings.archiveTag)
            indexSinglePage(page, graph, settings)
          } catch (fileErr) {
            console.warn(`[mdtree] Error indexing ${file.path}:`, fileErr)
          }
        }
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        continue
      }

      for (const page of pages) {
        try {
          indexSinglePage(page, graph, settings)
          // No parseTokensFn needed: precomputedTokens is populated on each DvList
        } catch (err) {
          console.warn(`[mdtree] Error indexing ${page.file.path}:`, err)
        }
      }

      await new Promise<void>(resolve => setTimeout(resolve, 0))
    }

    // Process other files (canvas, attachments) individually
    for (let i = 0; i < otherFiles.length; i++) {
      if (i % BATCH_SIZE === 0) {
        await new Promise<void>(resolve => setTimeout(resolve, 0))
      }
      const file = otherFiles[i]
      const { content, mtime } = await scanner.readFile(file.path)
      await indexScannedFile(file.path, content, mtime, graph, settings, provider.parseTokens.bind(provider))
    }
  } else {
    // FALLBACK PATH: unchanged file-by-file behavior
    for (let i = 0; i < files.length; i++) {
      if (i % BATCH_SIZE === 0) {
        await new Promise<void>(resolve => setTimeout(resolve, 0))
      }
      const file = files[i]
      const { content, mtime } = await scanner.readFile(file.path)
      await indexScannedFile(file.path, content, mtime, graph, settings)
    }
  }

  return graph
}

export async function reindexFileInGraph(
  relPath: string,
  graph: NotesGraph,
  scanner: VaultScanner,
  settings: IndexSettings,
  provider?: ParserProvider,
): Promise<void> {
  graph.removeByPath(relPath)
  const { content, mtime } = await scanner.readFile(relPath)

  if (provider) {
    const ext = extname(relPath)
    if (ext === ".md") {
      const page = provider.parseVaultFile(content, relPath, mtime, settings.archiveTag)
      indexSinglePage(page, graph, settings)
      // precomputedTokens is populated, so no extra WASM calls
    } else {
      await indexScannedFile(relPath, content, mtime, graph, settings, provider.parseTokens.bind(provider))
    }
  } else {
    await indexScannedFile(relPath, content, mtime, graph, settings)
  }
}
