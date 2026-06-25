# Remove WASM Parser, Unify Code Paths, Persistent mtime Cache

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the Rust/WASM parser and `ParserProvider` abstraction, collapse `buildGraphFromScanner` to a single TypeScript path, add `serializeCache`/`deserializeCache` utilities, and wire persistent mtime cache into both the Obsidian plugin (`IndexedTree`) and the CLI (`buildGraph`).

**Architecture:** All four tasks are sequential. Task 1 is pure deletion/simplification — no new capability. Task 2 adds the serialization primitives (TDD). Task 3 wires disk persistence into the Obsidian plugin. Task 4 wires it into the CLI and threads `cache` through the watcher/serve commands.

**Tech Stack:** TypeScript, Bun test runner, `node:fs/promises`, Obsidian `vault.adapter` API.

---

### Task 1: Delete WASM package and provider; simplify `buildGraphFromScanner`

**Files:**
- Delete: `packages/parser-native/` (entire dir)
- Delete: `src/wasm/parser-native-wasm.ts`
- Delete: `src/indexing/load-native-parser.ts`
- Delete: `packages/core/src/parser/parser-provider.ts`
- Delete: `packages/core/src/__tests__/builder-provider.test.ts`
- Delete: `packages/core/src/__tests__/parser-provider.test.ts`
- Rewrite: `packages/core/src/graph/builder.ts`
- Modify: `packages/core/src/index.ts`
- Rewrite: `src/indexing/indexed-tree.ts`
- Modify: `src/view/react-context/global.tsx`
- Modify: `src/view/SearchPage.tsx`
- Modify: `src/main.ts`
- Modify: `package.json`
- Modify: `esbuild.config.mjs`

- [ ] **Step 1: Delete WASM and provider files**

```bash
rm -rf packages/parser-native
rm src/wasm/parser-native-wasm.ts
rm src/indexing/load-native-parser.ts
rm packages/core/src/parser/parser-provider.ts
rm packages/core/src/__tests__/builder-provider.test.ts
rm packages/core/src/__tests__/parser-provider.test.ts
```

- [ ] **Step 2: Rewrite `packages/core/src/graph/builder.ts`**

Replace the entire file with the simplified single-path version:

```typescript
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
```

- [ ] **Step 3: Update `packages/core/src/index.ts`** — remove the two provider export lines

Remove these lines:
```typescript
export type { ParserProvider, FileInput } from "./parser/parser-provider.ts"
export { TsParserProvider, createTsParserProvider } from "./parser/parser-provider.ts"
```

- [ ] **Step 4: Rewrite `src/indexing/indexed-tree.ts`** — remove `provider` field and `setParserProvider`

```typescript
import { NotesGraph, buildGraphFromScanner, reindexFileInGraph, type ParseCacheEntry } from "@mdtree/core"
import { TFile } from "obsidian"
import { getSettings } from "../view/react-context/settings"
import { GlobalAtoms, GlobalStore } from "../view/react-context/global"
import { ObsidianVaultScanner } from "./obsidian-vault-scanner"

export class IndexedTree {
    private graph: NotesGraph
    private isLoading = false
    private version = 0
    private parseCache = new Map<string, ParseCacheEntry>()

    constructor(private store: GlobalStore) {
        this.graph = new NotesGraph()
    }

    private get vault() {
        return this.store.get(GlobalAtoms.appAtom).vault
    }

    private get metadataCache() {
        return this.store.get(GlobalAtoms.appAtom).metadataCache
    }

    async refresh(): Promise<void> {
        if (this.isLoading) return
        this.isLoading = true
        try {
            const settings = getSettings(this.store)
            const graph = await buildGraphFromScanner(
                new ObsidianVaultScanner(this.vault, this.metadataCache),
                {
                    parentRelation: settings.parentRelation,
                    archiveTag: settings.archiveTag,
                    searchSeparator: settings.searchSeparator,
                },
                this.parseCache,
            )
            this.setState(graph)
        } finally {
            this.isLoading = false
        }
    }

    async refreshPage(file: TFile): Promise<void> {
        try {
            const settings = getSettings(this.store)
            await reindexFileInGraph(
                file.path,
                this.graph,
                new ObsidianVaultScanner(this.vault, this.metadataCache),
                {
                    parentRelation: settings.parentRelation,
                    archiveTag: settings.archiveTag,
                    searchSeparator: settings.searchSeparator,
                },
                this.parseCache,
            )
            this.setState(this.graph)
        } catch (err) {
            console.warn(`[mdtree] Failed to reindex ${file.path}:`, err)
        }
    }

    private setState(graph: NotesGraph): void {
        this.graph = graph
        this.store.set(GlobalAtoms.graphAtom, graph)
        this.store.set(GlobalAtoms.graphVersionAtom, ++this.version)
        this.store.set(GlobalAtoms.isGraphLoadingAtom, false)
    }

    getCacheStats(): { size: number; entries: string[] } {
        const entries = Array.from(this.parseCache.keys())
        return { size: entries.length, entries }
    }

    clearCache(): void {
        this.parseCache.clear()
    }
}
```

- [ ] **Step 5: Update `src/view/react-context/global.tsx`** — remove `parserTypeAtom`

Replace the entire file:

```typescript
import {NotesGraph} from "@mdtree/core";
import {App, Modal, TFile} from "obsidian";
import {getDefaultStore, atom} from "jotai";

const appAtom = atom<App>(null as any as App)
const graphAtom = atom<NotesGraph>(new NotesGraph())
const graphVersionAtom = atom(0)
const isGraphLoadingAtom = atom(false)
const currentModalAtom = atom<Modal | null>(null)
const pinAtom = atom<boolean>(false)

export type GlobalStore = ReturnType<typeof getDefaultStore>

export const GlobalAtoms = {
    appAtom,
    graphAtom,
    graphVersionAtom,
    isGraphLoadingAtom,
    currentModalAtom,
    pinAtom,
    activeFileAtom: atom<TFile | undefined>(undefined)
}
```

- [ ] **Step 6: Update `src/view/SearchPage.tsx`** — remove `parserType` from the status bar

Remove line 48:
```typescript
    const parserType = useAtomValue(GlobalAtoms.parserTypeAtom)
```

Change line 57 from:
```typescript
                    <span className="text-[10px] text-obs-base-40">parser: {parserType} • {graphOrder} nodes</span>
```
To:
```typescript
                    <span className="text-[10px] text-obs-base-40">{graphOrder} nodes</span>
```

- [ ] **Step 7: Update `src/main.ts`** — remove WASM loading block

Remove this import:
```typescript
import {loadNativeParserProvider} from "./indexing/load-native-parser";
```

Remove these lines (the WASM loading block inside `onload`):
```typescript
        // Load WASM parser BEFORE any interval/subscription that may trigger refresh(),
        // to ensure the first graph refresh always uses the native parser if available.
        const nativeProvider = await loadNativeParserProvider()
        if (nativeProvider) {
            this.index.setParserProvider(nativeProvider)
            this.globalStore.set(GlobalAtoms.parserTypeAtom, "native-wasm")
            console.debug("[mdtree] Native WASM parser loaded successfully")
        }
```

- [ ] **Step 8: Update `package.json`** — remove wasm scripts and dependency

Replace the `"scripts"` block with:
```json
"scripts": {
    "test": "bun test",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "dev": "node esbuild.config.mjs",
    "mdtree:build": "bun build --compile --target=bun packages/cli/src/main.ts --outfile=dist/mdtree",
    "mdtree:test": "bun test packages/core/src/__tests__",
    "mdtree:dev": "bun run packages/cli/src/main.ts"
},
```

Remove `"@mdtree/parser-native": "workspace:*"` from `"dependencies"`.

- [ ] **Step 9: Update `esbuild.config.mjs`** — remove `wasmInlinePlugin`

Remove lines 9–28 (the `wasmInlinePlugin` const definition).

Remove this line from the esbuildOptions object (line 87):
```javascript
	loader: { '.wasm': 'empty' },
```

Remove `wasmInlinePlugin,` from the `plugins` array (currently line 90).

Also remove the two comment lines above the `loader` key (lines 82–86) that explain the wasm loader.

- [ ] **Step 10: Run tests**

```bash
bun test packages/core/src/__tests__ packages/cli/src/__tests__
```

Expected: all pass. Count will be ~131 (147 baseline minus 16 deleted tests from the two provider test files).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: remove WASM parser, provider abstraction, and simplify buildGraphFromScanner"
```

---

### Task 2: Add cache serialization module (TDD)

**Files:**
- Create: `packages/core/src/graph/cache.ts`
- Create: `packages/core/src/__tests__/cache.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/__tests__/cache.test.ts`:

```typescript
import { describe, it, expect } from "bun:test"
import { serializeCache, deserializeCache } from "../graph/cache.ts"
import type { ParseCacheEntry } from "../graph/builder.ts"
import { parseVaultFile } from "../parser/vault-file.ts"

function makeEntry(content: string, path: string, mtime: number): ParseCacheEntry {
  return { page: parseVaultFile(content, path, mtime), mtime }
}

describe("serializeCache / deserializeCache", () => {
  it("round-trips a populated cache", () => {
    const cache = new Map<string, ParseCacheEntry>([
      ["folder/note.md", makeEntry("- [[Link]] text", "folder/note.md", 1700000000000)],
      ["other.md", makeEntry("# Title", "other.md", 1700000001000)],
    ])

    const json = serializeCache(cache)
    const restored = deserializeCache(json)

    expect(restored.size).toBe(2)
    expect(restored.get("folder/note.md")?.mtime).toBe(1700000000000)
    expect(restored.get("other.md")?.mtime).toBe(1700000001000)
    expect(restored.get("folder/note.md")?.page.file.path).toBe("folder/note.md")
  })

  it("round-trips an empty cache", () => {
    const json = serializeCache(new Map())
    const restored = deserializeCache(json)
    expect(restored.size).toBe(0)
  })

  it("returns empty Map for corrupted JSON", () => {
    expect(deserializeCache("not valid json{{{").size).toBe(0)
  })

  it("returns empty Map for unknown version", () => {
    expect(deserializeCache(JSON.stringify({ version: 99, entries: {} })).size).toBe(0)
  })

  it("returns empty Map for empty string", () => {
    expect(deserializeCache("").size).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
bun test packages/core/src/__tests__/cache.test.ts
```

Expected: FAIL — `Cannot find module '../graph/cache.ts'`

- [ ] **Step 3: Create `packages/core/src/graph/cache.ts`**

```typescript
import type { ParseCacheEntry } from "./builder.ts"

type SerializedCache = {
  version: 1
  entries: Record<string, ParseCacheEntry>
}

export function serializeCache(cache: Map<string, ParseCacheEntry>): string {
  const entries: Record<string, ParseCacheEntry> = {}
  for (const [path, entry] of cache) {
    entries[path] = entry
  }
  return JSON.stringify({ version: 1, entries } satisfies SerializedCache)
}

export function deserializeCache(json: string): Map<string, ParseCacheEntry> {
  try {
    const parsed = JSON.parse(json) as SerializedCache
    if (!parsed || parsed.version !== 1 || typeof parsed.entries !== "object") {
      return new Map()
    }
    return new Map(Object.entries(parsed.entries))
  } catch {
    return new Map()
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
bun test packages/core/src/__tests__/cache.test.ts
```

Expected: 5 pass

- [ ] **Step 5: Export from `packages/core/src/index.ts`**

Add this line after the `buildGraphFromScanner` export line:
```typescript
export { serializeCache, deserializeCache } from "./graph/cache.ts"
```

- [ ] **Step 6: Run all core tests**

```bash
bun test packages/core/src/__tests__
```

Expected: all pass (131 + 5 new = 136 total)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/graph/cache.ts packages/core/src/__tests__/cache.test.ts packages/core/src/index.ts
git commit -m "feat: add serializeCache / deserializeCache for persistent mtime cache"
```

---

### Task 3: Plugin persistent cache

**Files:**
- Rewrite: `src/indexing/indexed-tree.ts`
- Modify: `src/main.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Rewrite `src/indexing/indexed-tree.ts`** — add `cacheDir` constructor param, `loadCache`/`saveCache`

```typescript
import { NotesGraph, buildGraphFromScanner, reindexFileInGraph, type ParseCacheEntry, serializeCache, deserializeCache } from "@mdtree/core"
import { TFile } from "obsidian"
import { getSettings } from "../view/react-context/settings"
import { GlobalAtoms, GlobalStore } from "../view/react-context/global"
import { ObsidianVaultScanner } from "./obsidian-vault-scanner"

export class IndexedTree {
    private graph: NotesGraph
    private isLoading = false
    private version = 0
    private parseCache = new Map<string, ParseCacheEntry>()

    constructor(private store: GlobalStore, private cacheDir: string) {
        this.graph = new NotesGraph()
    }

    private get vault() {
        return this.store.get(GlobalAtoms.appAtom).vault
    }

    private get metadataCache() {
        return this.store.get(GlobalAtoms.appAtom).metadataCache
    }

    private get cachePath(): string {
        return `${this.cacheDir}/parse-cache.json`
    }

    private async loadCache(): Promise<void> {
        try {
            const json = await this.vault.adapter.read(this.cachePath)
            this.parseCache = deserializeCache(json)
        } catch {
            this.parseCache = new Map()
        }
    }

    private async saveCache(): Promise<void> {
        try {
            await this.vault.adapter.write(this.cachePath, serializeCache(this.parseCache))
        } catch (err) {
            console.warn("[mdtree] Failed to save parse cache:", err)
        }
    }

    async refresh(): Promise<void> {
        if (this.isLoading) return
        this.isLoading = true
        try {
            await this.loadCache()
            const settings = getSettings(this.store)
            const graph = await buildGraphFromScanner(
                new ObsidianVaultScanner(this.vault, this.metadataCache),
                {
                    parentRelation: settings.parentRelation,
                    archiveTag: settings.archiveTag,
                    searchSeparator: settings.searchSeparator,
                },
                this.parseCache,
            )
            await this.saveCache()
            this.setState(graph)
        } finally {
            this.isLoading = false
        }
    }

    async refreshPage(file: TFile): Promise<void> {
        try {
            const settings = getSettings(this.store)
            await reindexFileInGraph(
                file.path,
                this.graph,
                new ObsidianVaultScanner(this.vault, this.metadataCache),
                {
                    parentRelation: settings.parentRelation,
                    archiveTag: settings.archiveTag,
                    searchSeparator: settings.searchSeparator,
                },
                this.parseCache,
            )
            this.setState(this.graph)
        } catch (err) {
            console.warn(`[mdtree] Failed to reindex ${file.path}:`, err)
        }
    }

    private setState(graph: NotesGraph): void {
        this.graph = graph
        this.store.set(GlobalAtoms.graphAtom, graph)
        this.store.set(GlobalAtoms.graphVersionAtom, ++this.version)
        this.store.set(GlobalAtoms.isGraphLoadingAtom, false)
    }

    getCacheStats(): { size: number; entries: string[] } {
        const entries = Array.from(this.parseCache.keys())
        return { size: entries.length, entries }
    }

    clearCache(): void {
        this.parseCache.clear()
    }
}
```

- [ ] **Step 2: Update `src/main.ts`** — pass `this.manifest.dir` to `IndexedTree`

Change:
```typescript
        this.index = new IndexedTree(this.globalStore);
```
To:
```typescript
        this.index = new IndexedTree(this.globalStore, this.manifest.dir);
```

- [ ] **Step 3: Append to `.gitignore`**

Add:
```
# mdtree CLI parse cache
.mdtree/
```

- [ ] **Step 4: Run tests to confirm no regression**

```bash
bun test packages/core/src/__tests__ packages/cli/src/__tests__
```

Expected: all pass (136 total)

- [ ] **Step 5: Commit**

```bash
git add src/indexing/indexed-tree.ts src/main.ts .gitignore
git commit -m "feat: persist mtime parse cache across Obsidian plugin restarts"
```

---

### Task 4: CLI persistent cache

**Files:**
- Rewrite: `packages/cli/src/vault/indexer.ts`
- Rewrite: `packages/cli/src/commands/watch.ts`
- Rewrite: `packages/cli/src/commands/serve.ts`
- Modify: `packages/cli/src/commands/index.ts`
- Rewrite: `packages/cli/src/plugins/trigger.ts`
- Modify: `packages/cli/src/__tests__/query.test.ts`

- [ ] **Step 1: Rewrite `packages/cli/src/vault/indexer.ts`**

```typescript
import { relative, join, dirname } from "node:path"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import {
  NotesGraph,
  buildGraphFromScanner,
  reindexFileInGraph,
  type IndexSettings,
  DEFAULT_SETTINGS,
  type ParseCacheEntry,
  serializeCache,
  deserializeCache,
} from "@mdtree/core"
import { NodeVaultScanner } from "./node-scanner.ts"
import type { VaultStore } from "../store/sqlite.ts"

function cacheFilePath(vaultRoot: string): string {
  return join(vaultRoot, ".mdtree", "cache.json")
}

async function loadCacheFromFile(cacheFile: string): Promise<Map<string, ParseCacheEntry>> {
  try {
    const json = await readFile(cacheFile, "utf-8")
    return deserializeCache(json)
  } catch {
    return new Map()
  }
}

async function saveCacheToFile(cacheFile: string, cache: Map<string, ParseCacheEntry>): Promise<void> {
  try {
    await mkdir(dirname(cacheFile), { recursive: true })
    await writeFile(cacheFile, serializeCache(cache), "utf-8")
  } catch (err) {
    console.warn("[mdtree] Failed to save parse cache:", err)
  }
}

// ── Build full graph from vault ───────────────────────────────────────────────

export async function buildGraph(
  vaultRoot: string,
  settings: IndexSettings = DEFAULT_SETTINGS,
): Promise<{ graph: NotesGraph; cache: Map<string, ParseCacheEntry> }> {
  const cacheFile = cacheFilePath(vaultRoot)
  const cache = await loadCacheFromFile(cacheFile)
  const graph = await buildGraphFromScanner(new NodeVaultScanner(vaultRoot), settings, cache)
  await saveCacheToFile(cacheFile, cache)
  return { graph, cache }
}

// ── Incremental re-index of a single changed file ────────────────────────────

export async function reindexFile(
  absPath: string,
  vaultRoot: string,
  graph: NotesGraph,
  settings: IndexSettings,
  parseCache?: Map<string, ParseCacheEntry>,
  store?: VaultStore,
  vault?: string,
): Promise<void> {
  const relPath = relative(vaultRoot, absPath)

  await reindexFileInGraph(relPath, graph, new NodeVaultScanner(vaultRoot), settings, parseCache)

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
```

- [ ] **Step 2: Rewrite `packages/cli/src/commands/watch.ts`** — thread `cache` through `loadOrBuild` and `reindexFile`

```typescript
import { resolve, basename } from "node:path"
import { DEFAULT_SETTINGS, NotesGraph, type ParseCacheEntry } from "@mdtree/core"
import { buildGraph, reindexFile } from "../vault/indexer.ts"
import { watchVault } from "../vault/watcher.ts"
import { VaultStore, defaultDbPath } from "../store/sqlite.ts"
import { AsyncQueue } from "../util/async-queue.ts"
import { enqueuePluginRuns } from "../plugins/trigger.ts"

export type WatchOptions = {
  dirs: string[]
  out?: string
  fresh?: boolean
}

export async function runWatch(opts: WatchOptions): Promise<void> {
  if (opts.out && opts.dirs.length > 1) {
    console.error("[mdtree] --out cannot be used with multiple --dir arguments")
    process.exit(1)
  }

  const stoppers: (() => void)[] = []

  for (const dir of opts.dirs) {
    const vaultRoot = resolve(dir)
    const vaultName = basename(vaultRoot)
    const dbPath = opts.out ?? defaultDbPath(vaultName)

    const { graph, store, cache } = await loadOrBuild(vaultRoot, vaultName, dbPath, opts.fresh)

    console.log(`[mdtree] Watching ${vaultRoot} ...`)

    const queue = new AsyncQueue()
    enqueuePluginRuns(vaultRoot, vaultName, graph, DEFAULT_SETTINGS, store, queue, cache)
    const stop = watchVault(vaultRoot, event => {
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
      stop()
      store.close()
    })
  }

  await waitForSignal()
  for (const stop of stoppers) stop()
}

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000

export async function loadOrBuild(
  vaultRoot: string,
  vaultName: string,
  dbPath: string,
  fresh = false,
): Promise<{ graph: NotesGraph; store: VaultStore; cache: Map<string, ParseCacheEntry> }> {
  const store = new VaultStore(dbPath)

  if (!fresh && store.hasData(vaultName)) {
    const lastIndexed = store.lastIndexed(vaultName)
    if (lastIndexed > 0) {
      const ageMs = Date.now() - lastIndexed
      if (ageMs > STALE_THRESHOLD_MS) {
        const hours = Math.round(ageMs / 3_600_000)
        console.warn(`[mdtree] Cache is ${hours}h old — run with --fresh to rebuild`)
      }
    }
    console.log(`[mdtree] Loading from cache: ${dbPath}`)
    const start = Date.now()
    const graph = new NotesGraph()
    store.loadIntoGraph(vaultName, graph)
    console.log(`[mdtree] Loaded ${graph.order} nodes in ${Date.now() - start}ms`)
    return { graph, store, cache: new Map() }
  }

  console.log(`[mdtree] Building graph for: ${vaultRoot}`)
  const start = Date.now()
  const { graph, cache } = await buildGraph(vaultRoot, DEFAULT_SETTINGS)
  console.log(`[mdtree] Built ${graph.order} nodes in ${Date.now() - start}ms`)
  store.saveGraph(vaultName, graph)
  return { graph, store, cache }
}

function waitForSignal(): Promise<void> {
  return new Promise(resolve => {
    process.once("SIGINT", resolve)
    process.once("SIGTERM", resolve)
  })
}
```

- [ ] **Step 3: Rewrite `packages/cli/src/commands/serve.ts`** — destructure `cache`, pass through

```typescript
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
```

- [ ] **Step 4: Update `packages/cli/src/commands/index.ts`** — destructure `{graph}` from `buildGraph`

Change:
```typescript
    const graph = await buildGraph(vaultRoot, DEFAULT_SETTINGS)
    const nodeCount = graph.order
```
To:
```typescript
    const { graph } = await buildGraph(vaultRoot, DEFAULT_SETTINGS)
    const nodeCount = graph.order
```

- [ ] **Step 5: Rewrite `packages/cli/src/plugins/trigger.ts`** — add optional `cache` param

```typescript
import type { NotesGraph, IndexSettings, ParseCacheEntry } from "@mdtree/core"
import type { VaultStore } from "../store/sqlite.ts"
import type { AsyncQueue } from "../util/async-queue.ts"
import { listInstalledPlugins } from "./registry.ts"
import { runPlugin } from "./runner.ts"
import { reindexFile } from "../vault/indexer.ts"

export function enqueuePluginRuns(
  vaultRoot: string,
  vaultName: string,
  graph: NotesGraph,
  settings: IndexSettings,
  store: VaultStore,
  queue: AsyncQueue,
  cache?: Map<string, ParseCacheEntry>,
): void {
  const installed = listInstalledPlugins()
  if (installed.length === 0) return

  for (const plugin of installed) {
    queue.enqueue(async () => {
      const config = store.getPluginConfig(vaultName, plugin.namespace)
      if (!config.enabled) return

      console.log(`[${vaultName}] Running plugin: ${plugin.namespace}`)
      const outputPath = await runPlugin(plugin, config, vaultRoot)

      if (outputPath) {
        store.setPluginOutputPath(vaultName, plugin.namespace, outputPath)
        await reindexFile(outputPath, vaultRoot, graph, settings, cache, store, vaultName)
        console.log(`[${vaultName}] Plugin ${plugin.namespace} indexed`)
      }
    })
  }
}
```

- [ ] **Step 6: Update `packages/cli/src/__tests__/query.test.ts`** — destructure `{graph}`

Change:
```typescript
  const graph = await buildGraph(vaultDir)
```
To:
```typescript
  const { graph } = await buildGraph(vaultDir)
```

- [ ] **Step 7: Run all tests**

```bash
bun test packages/core/src/__tests__ packages/cli/src/__tests__
```

Expected: all pass (136 total)

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/vault/indexer.ts packages/cli/src/commands/watch.ts packages/cli/src/commands/serve.ts packages/cli/src/commands/index.ts packages/cli/src/plugins/trigger.ts packages/cli/src/__tests__/query.test.ts
git commit -m "feat: add persistent mtime cache for CLI buildGraph and incremental reindexFile"
```
