## Quick orientation

This repo implements two complementary projects: the Obsidian plugin (root) and a Raycast companion (sibling repo `obsidian-tree-search-raycast`). The plugin builds a searchable knowledge graph from Obsidian notes and exposes a small HTTP-over-unix-socket API consumed by the Raycast extension.

## High level architecture (key files)
- Entry: `src/main.ts` — plugin lifecycle, registers views and starts the `RaycastServer`.
- Indexing: `src/indexing/*` — `markdown.ts`, `canvas.ts`, `indexed-tree.ts` create/refresh the graph.
- Graph model & search: `src/graph.ts`, `src/search/*` — graph node keys use `getKey()` (pages are `[[name]]`, headers `page#header`, text tokens use raw `searchKey`).
- UI: `src/view/*` — React components, `SearchPage.tsx`, `SearchTreeNode.tsx`, and modal components.
- Raycast companion: `../obsidian-tree-search-raycast/src` — `fetch.ts` shows how Raycast queries the plugin via a unix socket (format: `/tmp/raycast-{vaultname}.sock`).

## Important integrations & runtime notes
- The plugin depends on Dataview being available (see `waitForDataview()` in `main.ts`). Tests mock Obsidian APIs in `tests/__mocks__/obsidian.ts`.
- IPC: Raycast <-> Obsidian uses an HTTP server bound to a unix socket (see `view/raycast/raycast-server.ts` and `obsidian-tree-search-raycast/src/fetch.ts`). The Raycast preference `socketPath` must match the plugin setting (placeholder: `/tmp/raycast-{vaultname}.sock`).
- State management: `jotai` + `bunshi` scopes are used across React components (`view/react-context/*`). Avoid changing global atom shapes unless you update all consumers.

## Build, dev & test commands (how to run)
- Plugin (root `obsidian-tree-search`):
  - dev: `npm run dev` (runs `node esbuild.config.mjs`)
  - build: `npm run build` (runs `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`)
  - tests: `npm run test` (Jest, mocks live under `tests/__mocks__`)
- Raycast extension (`obsidian-tree-search-raycast`):
  - dev: `npm run dev` (uses `ray develop`)
  - build/publish: `npm run build` / `npm run publish` (uses Raycast CLI)

## Project-specific conventions & patterns
- Node keys: the graph uses deterministic string keys — pages `[[basename]]`, headers `page#header`. See `getKey()` in `src/graph.ts` before editing search or serialization logic.
- Search parsing: queries are split by the user-configurable separator (settings UI in `main.ts` -> settings tab); search expression parsing lives in `src/search/query.ts`.
- Age/boost heuristics: `graph.ts` computes node boosts using filename dates, mtime and emoji presence — altering ranking requires changing `calculateBoost()`.
- Protocol handler: `registerObsidianProtocolHandler('tree-search-uri', ...)` encodes actions used by Raycast (e.g. `open`, `insert`, `revealFolder`, `moveToFolder`). If you add new actions, update the Raycast side to call them.

## Tests & mocking
- Unit tests run with Jest. They rely on `tests/__mocks__/obsidian.ts` to stub Obsidian runtime APIs. When adding tests that reference Obsidian objects, add or extend mocks accordingly.

## Quick examples for code edits
- To change how pages are indexed, start in `src/indexing/markdown.ts` and verify node keys in `src/graph.ts`. Unit tests in `tests/indexing` cover parser behavior.
- To change Raycast protocol or socket behavior, update `view/raycast/raycast-server.ts` (plugin) and `obsidian-tree-search-raycast/src/fetch.ts` (client).

If anything above is unclear or you want the instructions to prioritize a different area (tests, release flow, or UI conventions), tell me which section and I’ll refine it.
