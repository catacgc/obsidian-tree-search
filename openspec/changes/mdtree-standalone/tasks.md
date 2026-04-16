# Tasks: mdtree Standalone

Implementation order: core package first (bottom-up), CLI on top.

---

## Phase 1 — Repo & workspace setup

- [x] Add `packages/core` and `packages/cli` to repo with Bun workspaces
- [x] Configure `package.json` at root with `workspaces: ["packages/*"]`
- [x] Set up `tsconfig.json` for each package (strict, no lib dom in core)
- [x] Set up `bun:test` in each package

---

## Phase 2 — `@mdtree/core`: types & graph

- [x] Port node/edge type definitions from `src/graph.ts` (remove Obsidian/Dataview types)
- [x] Implement `NotesGraph` with plain Maps + `byPath` index (replace graphology)
- [x] Port `boost.ts` (calculateBoost, getAgeDays — already pure)
- [x] Write unit tests: add/remove nodes, addChild, removeByPath

---

## Phase 3 — `@mdtree/core`: parser

- [x] Implement `frontmatter.ts` — strip and parse YAML between `---` delimiters
- [x] Implement `list-scanner.ts` — line scanner → DvList-equivalent tree
  - [x] ATX header detection + section tracking
  - [x] List item indent stack → parent references
  - [x] Task marker detection (`- [ ]` / `- [x]`)
  - [x] Inline tag extraction (`#tag`)
  - [x] shouldSkip heuristic (no `[[`, `#`, `http`, task)
  - [x] Wire `.children` in post-pass
- [x] Implement `vault-file.ts` — orchestrate frontmatter + list-scanner → `ParsedVaultFile`
- [x] Port `inline-tokens.ts` from `src/indexing/parser.ts` (markdown-it, no changes needed)
- [x] Port `canvas.ts` from `src/indexing/canvas.ts`:
  - [x] Lift `parseCanvasData()` and types (already pure)
  - [x] Add Pass 2: build `canvasRootMap` during node creation
  - [x] Add Pass 3: wire `CanvasData.edges` → `"related"` graph edges
- [x] Write parser unit tests against fixture .md and .canvas files

---

## Phase 4 — `@mdtree/core`: indexer & search

- [x] Implement `indexer.ts` — `ParsedVaultFile[]` → `NotesGraph`
  - [x] Port `indexSinglePage()` from `src/indexing/markdown.ts` (consumes DvList tree)
  - [x] Port `createNodeFromText()` from `src/indexing/text-parser.ts`
  - [x] Port folder node creation from `src/graph.ts`
- [x] Port `search/query.ts` verbatim (already pure)
- [x] Port `search/search.ts` (remove `TFile` import, use `string` for file refs)
- [x] Write search integration tests: build graph from fixtures, run queries, assert results

---

## Phase 5 — `@mdtree/cli`: vault I/O

- [x] Implement `vault/walker.ts` — walk directory, yield .md / .canvas / attachment paths
  - [x] Respect `.obsidianignore` if present
  - [x] Yield folder entries for FolderNode creation
- [x] Implement `vault/watcher.ts` — chokidar wrapper, 200ms debounce per file path

---

## Phase 6 — `@mdtree/cli`: persistence

- [x] Implement `store/schema.ts` — CREATE TABLE + index statements
- [x] Implement `store/sqlite.ts` using `bun:sqlite`:
  - [x] `load(vault): { nodes, edges }` — bulk read for warm start
  - [x] `save(vault, nodes, edges)` — bulk insert after full parse
  - [x] `updateFile(vault, path, nodes, edges)` — incremental: DELETE + INSERT
  - [x] Default path: `$HOME/.config/mdtree/{vaultname}.db`

---

## Phase 7 — `@mdtree/cli`: server & response

- [x] Implement `server/response.ts` — `NotesGraph` search result → `VaultResults` JSON
  - [x] Port `flattenIndex()` from `src/view/react-context/state.tsx`
  - [x] Port `createRaycastResponse()` from `src/view/raycast/raycast-response.ts`
- [x] Implement `server/server.ts`:
  - [x] `Bun.serve({ unix: socketPath })` — default, Raycast-compatible
  - [x] `Bun.serve({ port })` — opt-in TCP
  - [x] Multi-vault: one server per vault, all in same process
  - [x] Request parsing: `?query=&limit=`

---

## Phase 8 — `@mdtree/cli`: commands

- [x] Implement `commands/index.ts` — `mdtree index`
  - [x] Walk vault → parse all files → build graph → write SQLite → exit
- [x] Implement `commands/watch.ts` — `mdtree watch`
  - [x] Warm-start from SQLite (or full parse)
  - [x] File change → `graph.removeByPath` + reparse + `sqlite.updateFile`
- [x] Implement `commands/serve.ts` — `mdtree serve`
  - [x] All of watch, plus start HTTP server per vault
  - [x] Multiple `--vault` flags supported
- [x] Wire CLI entrypoint with commander/citty
- [x] Build single binary: `bun build --compile`

---

## Phase 9 — Validation

- [x] Run against a real vault, compare output with current Obsidian plugin
- [x] Verify existing Raycast extension works unchanged against `mdtree serve`
- [x] Performance check: cold start, warm start, incremental update timings
