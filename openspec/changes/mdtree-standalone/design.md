# Design: mdtree Standalone

## Package structure

```
packages/
  core/                    @mdtree/core — pure TS, zero I/O, no platform deps
  cli/                     @mdtree/cli  — Bun runtime, I/O, HTTP, SQLite
```

`@mdtree/core` must remain importable from the Obsidian plugin (bundled via esbuild, Electron context). No `bun:*`, `node:fs`, or any I/O API may appear in core.

```
packages/core/src/
  parser/
    frontmatter.ts          YAML frontmatter extraction (js-yaml or gray-matter)
    list-scanner.ts         raw markdown text → DvList-equivalent tree  ← new
    vault-file.ts           orchestrate: content + mtime → ParsedVaultFile
    inline-tokens.ts        obsidian links, URLs, decorations (wraps markdown-it)
    canvas.ts               .canvas JSON → graph nodes + edges
  graph/
    types.ts                all ParsedNode / Edge type defs (no Obsidian types)
    graph.ts                NotesGraph backed by plain Maps
    indexer.ts              ParsedVaultFile[] → NotesGraph
    boost.ts                boost calculation
  search/
    query.ts                full query language (copy from src/search/query.ts)
    search.ts               tree search algorithm (copy, remove TFile ref)
  index.ts                  public API

packages/cli/src/
  commands/
    index.ts                mdtree index
    watch.ts                mdtree watch
    serve.ts                mdtree serve
  vault/
    walker.ts               walk dir, emit .md / .canvas / attachment paths
    watcher.ts              chokidar wrapper, debounced per-file callbacks
  store/
    sqlite.ts               bun:sqlite — warm-start load/save, incremental update
    schema.ts               CREATE TABLE statements + migrations
  server/
    server.ts               Bun.serve() with unix: or port:, multi-vault dispatch
    response.ts             NotesGraph search results → VaultResults JSON
```

---

## Core: list scanner (the key new piece)

Replaces `dv.page(path)` which currently provides `file.lists: DvList[]`.

**Algorithm** — single-pass line scanner:

```
state:
  frontmatterEnd: number      skip lines 1..N if bounded by ---
  headerStack: string[]       current section path by level
  indentStack: {indent, lineNum}[]

for lineNum, line of lines:
  if in frontmatter: skip
  if ATX header /^(#{1,6})\s+(.+)/:
    level = hashes.length
    headerStack[level-1] = headerText
    headerStack.length = level       // truncate deeper
    indentStack = []                 // reset list nesting on new section
    continue
  if list item /^(\s*)[-*+]\s+(.*)/  or  /^(\s*)\d+\.\s+(.*)/  :
    indent = leadingSpaces.length
    text = content after marker
    if starts with [ ] / [x]: mark task/completed, strip prefix
    tags = all #word matches
    pop indentStack while top.indent >= indent
    parent = indentStack.top?.lineNum  (undefined = top-level)
    push {indent, lineNum} to indentStack
    emit DvListItem { text, line: lineNum, position, parent, tags,
                      task, completed,
                      section: { subpath: headerStack.last } }

post-pass: wire .children by grouping items by parent lineNum
```

Output shape is identical to Dataview's `DvList[]`. The existing `indexSinglePage()` in `markdown.ts` consumes this unchanged.

**What gets skipped** (same heuristic as current `shouldSkip()`):
```typescript
!text.includes("[[") && !text.includes("http") &&
!text.includes("#")  && !text.includes("- [")
```

---

## Core: canvas edges

Current code creates canvas nodes but discards `CanvasData.edges`. New behavior:

**Pass 1** — spatial grouping (existing: group nodes contain others by bounding box)

**Pass 2** — create graph nodes, record root mapping:
```typescript
const canvasRootMap = new Map<string, string>()  // canvasNodeId → graphNodeKey
// When first node is created from a canvas node:
canvasRootMap.set(canvasNode.id, firstCreatedNode.key)
```

**Pass 3** — wire canvas edges as `"related"` graph edges:
```typescript
for (const edge of canvasData.edges) {
  const fromKey = canvasRootMap.get(edge.fromNode)
  const toKey   = canvasRootMap.get(edge.toNode)
  if (fromKey && toKey)
    graph.addEdge(fromKey, toKey, { type: "related", ... })
}
```

Edge labels (`edge.label`) are ignored in v1.

---

## Core: graph (replacing graphology)

Plain Maps — no external dependency, smaller bundle for Obsidian reuse:

```typescript
class NotesGraph {
  private nodes    = new Map<string, ParsedNode>()
  private out      = new Map<string, Edge[]>()    // key → outbound edges
  private in       = new Map<string, Edge[]>()    // key → inbound edges
  private byPath   = new Map<string, Set<string>>() // srcPath → node keys + edge ids
}
```

`byPath` enables O(k) incremental cleanup:
```typescript
graph.removeByPath(changedFilePath)
// deletes all nodes and edges whose src_path == changedFilePath
```

The current plugin's `removeExistingPageEdges()` scans all edges — O(n). The `byPath` index fixes this.

---

## CLI: SQLite schema

Warm-start cache only. Source of truth is always the in-memory graph.

```sql
CREATE TABLE nodes (
  vault     TEXT NOT NULL,
  key       TEXT NOT NULL,
  node_type TEXT NOT NULL,
  src_path  TEXT NOT NULL,
  boost     INTEGER NOT NULL,
  age_days  INTEGER NOT NULL,
  data      JSON NOT NULL,
  PRIMARY KEY (vault, key)
);

CREATE TABLE edges (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  vault     TEXT NOT NULL,
  from_key  TEXT NOT NULL,
  to_key    TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  src_path  TEXT NOT NULL,
  mtime     INTEGER NOT NULL,
  location  JSON NOT NULL
);

CREATE INDEX idx_nodes_src ON nodes (vault, src_path);
CREATE INDEX idx_edges_src ON edges (vault, src_path);
```

**Startup sequence:**
1. Check if SQLite exists for this vault
2. If yes: bulk-load nodes + edges, hydrate in-memory graph (~200ms target)
3. If no: walk vault, parse all files, build graph, write SQLite (~5s target)
4. Start watcher + HTTP server

**Incremental update on file change:**
```
graph.removeByPath(path)
sqlite: DELETE FROM nodes WHERE vault=? AND src_path=?
        DELETE FROM edges WHERE vault=? AND src_path=?
parse file → newNodes, newEdges
graph.add(newNodes, newEdges)
sqlite: bulk INSERT newNodes, newEdges
```

SQLite default path: `$HOME/.config/mdtree/{vaultname}.db`

---

## CLI: HTTP server

```typescript
// Unix socket (default, Raycast-compatible)
Bun.serve({ unix: `/tmp/raycast-${vaultName}.sock`, fetch: handler })

// TCP (opt-in)
Bun.serve({ port: opts.port, fetch: handler })
```

**Request:** `GET /?query={encoded}&limit={n}`

**Response:** `VaultResults` — identical shape to current plugin:
```typescript
{
  vault: string
  results: IndividualListItemModel[]
  error?: string
}
```

Multi-vault: one `Bun.serve()` instance per vault, all in the same process.

---

## Migration path for the Obsidian plugin

1. `@mdtree/core` is published (or workspace-linked)
2. Obsidian plugin replaces `dv.page()` call with `parseVaultFile(content, path, mtime)`
3. Obsidian plugin drops Dataview dependency
4. `MarkdownIndexer` and `CanvasIndexer` become thin wrappers that read via `app.vault.read()` and delegate to core
5. Graphology replaced with `NotesGraph` from core
6. `RaycastServer` can be removed (mdtree serve handles it)

---

## Dependencies

| Package | Used in | Purpose |
|---|---|---|
| `markdown-it` | core | inline token parsing (obsidian links, URLs) |
| `js-yaml` or `gray-matter` | core | YAML frontmatter |
| `chokidar` | cli | reliable file watching (cross-platform) |
| `bun:sqlite` | cli | SQLite (built-in to Bun) |
| `commander` or `citty` | cli | CLI argument parsing |

`graphology` is **not** a dependency — replaced by plain Maps in core.
