# Tasks: rust-parser-06-core-integration

## Task 1 — Modify `indexSinglePage` to accept `parseTokensFn` and use pre-computed tokens

**Modify `packages/core/src/graph/indexer.ts`:**

Change the `indexSinglePage` export signature to accept an optional fourth parameter:

```typescript
export function indexSinglePage(
  page: DvPage,
  graph: NotesGraph,
  settings: IndexSettings,
  parseTokensFn: (text: string) => ParsedTextToken[] = parseTokens,
): ParsedNode | undefined
```

Add `ParsedTextToken` to the import from `"./types.ts"`.

**Modify `createNodeFromText` internal function:**

Change its signature to accept `parseTokensFn`:

```typescript
function createNodeFromText(
  graph: NotesGraph,
  page: DvPage,
  item: DvList,
  parseTokensFn: (text: string) => ParsedTextToken[],
): ParsedNode
```

At line 53, change:
```typescript
const parsed = parseTokens(item.rawText)
```
to:
```typescript
const parsed = item.precomputedTokens ?? parseTokensFn(item.rawText)
```

**Modify `createTreeFromTextLine` internal function:**

Change its signature to accept `parseTokensFn` and pass it to `createNodeFromText`:

```typescript
function createTreeFromTextLine(
  graph: NotesGraph,
  parentNode: ParsedNode,
  page: DvPage,
  item: DvList,
  parseTokensFn: (text: string) => ParsedTextToken[],
): ParsedNode {
  const createdNode = createNodeFromText(graph, page, item, parseTokensFn)
  // ... rest unchanged
}
```

**Modify the frontmatter parent loop (line 238 area):**

Change:
```typescript
const refs = graph.getObsidianLinkReferences(parseTokens(parent))
```
to:
```typescript
const refs = graph.getObsidianLinkReferences(
  page.precomputedParentTokens?.get(parent) ?? parseTokensFn(parent)
)
```

**Modify the `createSubtree` closure:**

It must capture and pass `parseTokensFn` to `createTreeFromTextLine`:

```typescript
function createSubtree(parent: ParsedNode, children: DvList[]): void {
  for (const child of children) {
    child.text = child.text.trim()
    if (shouldSkip(child, lineArchiveTag)) continue
    const created = createTreeFromTextLine(graph, parent, page, child, parseTokensFn)
    createSubtree(created, child.children)
  }
}
```

The existing `import { parseTokens } from "../parser/inline-tokens.ts"` stays -- it is used as the default value for the parameter.

**Verification:** `bun test packages/core` -- all existing tests pass (they call `indexSinglePage(page, graph, settings)` without the fourth argument, so the default `parseTokens` is used).

---

## Task 2 — Modify `buildNodesFromTextLines` and `parseCanvasData` to accept `parseTokensFn`

**Modify `packages/core/src/parser/text-lines.ts`:**

Change the `buildNodesFromTextLines` export signature to accept an optional `parseTokensFn`:

```typescript
export function buildNodesFromTextLines(
  lines: NodeTextLine[],
  pageNode: PageNode,
  graph: NotesGraph,
  onFirstKey?: (key: string, canvasNodeId: string | undefined) => void,
  parseTokensFn: (text: string) => ParsedTextToken[] = parseTokens,
): string | undefined
```

Add `ParsedTextToken` to the import from `"../graph/types.ts"`.

Pass `parseTokensFn` to `createNodeForLine`:

```typescript
function createNodeForLine(
  pageNode: PageNode,
  line: NodeTextLine,
  graph: NotesGraph,
  parseTokensFn: (text: string) => ParsedTextToken[],
): ParsedNode
```

Which passes it to `createTextNode`:

```typescript
function createTextNode(
  graph: NotesGraph,
  text: string,
  location: Location,
  isTask: boolean,
  isCompleted: boolean,
  ageDays: number,
  parseTokensFn: (text: string) => ParsedTextToken[],
): ParsedNode {
  const parsed = parseTokensFn(text)  // was: parseTokens(text)
  // ... rest unchanged
}
```

Update all calls within `buildNodesFromTextLines` to pass `parseTokensFn` through:
- `createNodeForLine(pageNode, line, graph, parseTokensFn)` (line 25)
- `createNodeForLine(pageNode, line.parent, graph, parseTokensFn)` (line 35)

**Modify `packages/core/src/parser/canvas.ts`:**

Change `parseCanvasData` signature:

```typescript
export function parseCanvasData(
  path: string,
  basename: string,
  canvasData: CanvasData,
  graph: NotesGraph,
  parseTokensFn?: (text: string) => ParsedTextToken[],
): NotesGraph
```

Add the appropriate import for `ParsedTextToken` from `"../graph/types.ts"`.

Thread `parseTokensFn` to `buildNodesFromTextLines`:

```typescript
buildNodesFromTextLines(node.lines, pageNode, graph, (key, canvasNodeId) => {
  if (canvasNodeId && !canvasRootMap.has(canvasNodeId)) {
    canvasRootMap.set(canvasNodeId, key)
  }
}, parseTokensFn)
```

Note: since `parseTokensFn` is the 5th parameter and `onFirstKey` is the 4th, when `parseTokensFn` is undefined (not passed), `buildNodesFromTextLines` will use its default (`parseTokens` import). This is the transparent fallback.

**Verification:** `bun test packages/core` -- all existing tests pass. Canvas tests in integration suite continue to work (no provider passed, defaults to TS `parseTokens`).

---

## Task 3 — Modify `buildGraphFromScanner` to accept `ParserProvider` and implement chunked batch flow with error recovery

**Modify `packages/core/src/graph/builder.ts`:**

Add imports:

```typescript
import type { ParserProvider } from "../parser/parser-provider.ts"
import type { ParsedTextToken } from "./types.ts"
```

Change `indexScannedFile` to accept an optional `parseTokensFn`:

```typescript
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
      // ... JSON.parse ...
      parseCanvasData(relPath, name, canvasData, graph, parseTokensFn)
    } else {
      // ... attachment unchanged
    }
  } catch (err) {
    console.warn(`[mdtree] Error indexing ${relPath}:`, err)
  }
}
```

Change `buildGraphFromScanner` signature:

```typescript
export async function buildGraphFromScanner(
  scanner: VaultScanner,
  settings: IndexSettings = DEFAULT_SETTINGS,
  provider?: ParserProvider,
  chunkSize = 50,
): Promise<NotesGraph>
```

Implement the dual-path logic with error recovery on `parseBatchChunk`:

```typescript
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
```

**Key design details:**
- When `provider` is given and batch produces `DvPage[]` with `precomputedTokens` populated, `indexSinglePage(page, graph, settings)` is called WITHOUT a `parseTokensFn` -- it defaults to TS `parseTokens`, but the code at line 53 hits `item.precomputedTokens` first (it's defined), so the default is never actually called.
- If `parseBatchChunk` throws (WASM panic, malformed content in any file in the chunk), the entire chunk is retried file-by-file using `provider.parseVaultFile` with individual try/catch per file. This preserves the per-file resilience of the existing `indexScannedFile` try/catch and avoids losing all 50 files in a chunk due to one bad file.
- For canvas files in the provider path, `provider.parseTokens` is passed as `parseTokensFn` so those calls go through WASM.
- The fallback path is literally the same code as today.

**Verification:** `bun test packages/core` -- the existing `builder.test.ts` calls `buildGraphFromScanner(scanner, settings)` without a provider, so it hits the fallback path unchanged.

---

## Task 4 — Modify `reindexFileInGraph` to accept optional `ParserProvider`

**Modify `packages/core/src/graph/builder.ts`:**

Change `reindexFileInGraph` signature:

```typescript
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
```

**Verification:** `bun test packages/core` -- existing tests don't pass a provider to `reindexFileInGraph`, so they hit the fallback path unchanged.

---

## Task 5 — Write tests for provider integration in `builder.ts`

**Create `packages/core/src/__tests__/builder-provider.test.ts`:**

Tests to implement:

1. **Batch path is used when provider is given:** Create a mock `ParserProvider` that wraps `TsParserProvider` but tracks calls to `parseBatchChunk`. Call `buildGraphFromScanner(scanner, settings, mockProvider)`. Assert `parseBatchChunk` was called (not zero times). Assert no individual `parseVaultFile` calls for `.md` files in the happy path.

2. **Batch path produces same graph as fallback path:** Call `buildGraphFromScanner(scanner, settings)` and `buildGraphFromScanner(scanner, settings, new TsParserProvider())`. Compare graphs (same nodes, same edges). Note: `TsParserProvider` does NOT populate `precomputedTokens`, so both paths call `parseTokens` directly -- the graph results should be identical.

3. **Chunked yielding occurs:** With 25 `.md` files and `chunkSize = 5`, verify that `parseBatchChunk` is called 5 times and that macrotasks fire between calls (similar pattern to existing `builder.test.ts`).

4. **Canvas files use provider.parseTokens:** Create a scanner with one `.canvas` file containing a text node with `[[Link]]`. Create a mock provider that wraps `TsParserProvider` and tracks `parseTokens` calls. Call `buildGraphFromScanner` with the provider. Assert `provider.parseTokens` was called at least once with a string containing `Link`.

5. **reindexFileInGraph with provider uses parseVaultFile:** Create a mock provider wrapping `TsParserProvider`, track `parseVaultFile` calls. Call `reindexFileInGraph(path, graph, scanner, settings, mockProvider)` for an `.md` file. Assert `parseVaultFile` was called once.

6. **reindexFileInGraph without provider uses fallback:** Call `reindexFileInGraph(path, graph, scanner, settings)` (no provider). Assert it still works (graph updated correctly).

7. **Batch chunk failure triggers per-file retry:** Create a mock provider where `parseBatchChunk` throws an error. Verify that `parseVaultFile` is called individually for each file in the failed chunk, and that files which succeed in the retry are indexed into the graph.

8. **Partial batch failure: only some files fail in retry:** Create a mock provider where `parseBatchChunk` throws, and `parseVaultFile` throws for one specific file but succeeds for others. Verify that the successfully parsed files are still indexed and only the failing file is logged as a warning.

**Verification:** `bun test packages/core/src/__tests__/builder-provider.test.ts` passes.

---

## Task 6 — Write tests for `precomputedTokens` usage in `indexer.ts`

**Create `packages/core/src/__tests__/indexer-precomputed.test.ts`:**

Tests to implement:

1. **precomputedTokens is used when present:** Create a `DvPage` with a `DvList` item where `precomputedTokens` is set to a known value (e.g., `[{ tokenType: "obsidian_link", source: "[[Foo]]", pageTarget: "Foo" }]`). Set `rawText` to something different (e.g., `"[[Bar]]"`). Call `indexSinglePage(page, graph, settings)`. Assert the graph contains a node for `"Foo"` (from precomputed) and NOT for `"Bar"` (from rawText parsed by TS). This proves `precomputedTokens` takes precedence.

2. **precomputedTokens undefined falls back to parseTokensFn:** Create a `DvPage` with `precomputedTokens` as `undefined`. Call `indexSinglePage(page, graph, settings)`. Assert the graph has nodes based on `rawText` content (normal behavior).

3. **precomputedParentTokens is used when present:** Create a `DvPage` with frontmatter `parent: "[[Root]]"` and set `precomputedParentTokens` to `new Map([["[[Root]]", [{ tokenType: "obsidian_link", source: "[[Root]]", pageTarget: "CustomRoot" }]]])`. Call `indexSinglePage(page, graph, settings)`. Assert the graph has a parent edge using "CustomRoot" (from precomputed tokens) rather than "Root" (which would come from TS parseTokens on `"[[Root]]"`).

4. **precomputedParentTokens undefined falls back to parseTokensFn:** Create a `DvPage` with frontmatter `parent: "[[Root]]"` and `precomputedParentTokens` as `undefined`. Call `indexSinglePage(page, graph, settings)`. Assert the graph has edge from `"[[root]]"` to the page (normal behavior via TS parseTokens).

5. **Custom parseTokensFn is called when no precomputed tokens:** Create a tracking function that wraps TS `parseTokens` and counts calls. Call `indexSinglePage(page, graph, settings, trackingFn)` with a page that has NO `precomputedTokens`. Assert the tracking function was called for each non-skipped list item.

6. **Custom parseTokensFn is NOT called when precomputedTokens present:** Same as above but with `precomputedTokens` populated. Assert the tracking function was never called.

**Verification:** `bun test packages/core/src/__tests__/indexer-precomputed.test.ts` passes.
