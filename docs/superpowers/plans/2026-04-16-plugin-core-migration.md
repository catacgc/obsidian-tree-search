# Plugin → @mdtree/core Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all duplicated graph, search, indexing, and Raycast code in `src/` with direct use of `@mdtree/core` and `@mdtree/cli`, making the plugin a thin Obsidian shell.

**Architecture:** Three layers executed in sequence, each leaving the plugin in a typechecking state. Layer 1 removes local types and search. Layer 2 replaces the vault indexer. Layer 3 removes Raycast and cleans up dependencies.

**Tech Stack:** TypeScript, `@mdtree/core` (workspace), `@mdtree/cli` (workspace), esbuild, Obsidian plugin API.

---

## File Map

### Deleted
- `src/graph.ts` — types + graphology NotesGraph → `@mdtree/core`
- `src/search/search.ts` — search functions → `@mdtree/core`
- `src/search/query.ts` — query parser → `@mdtree/core`
- `src/indexing/parser.ts` — parseTokens → `@mdtree/core`
- `src/indexing/text-parser.ts` — buildNodesFromTextLines → `@mdtree/core`
- `src/indexing/markdown.ts` — MarkdownIndexer → replaced by buildGraph
- `src/indexing/canvas.ts` — CanvasIndexer → replaced by buildGraph
- `src/view/raycast/raycast-server.ts` — replaced by `mdtree serve`
- `src/view/raycast/raycast-response.ts` — replaced by `mdtree serve`

### Rewritten
- `src/indexing/indexed-tree.ts` — thin wrapper: vault path + buildGraph/reindexFile
- `src/main.ts` — remove Dataview gate, remove RaycastServer
- `packages/cli/package.json` — add `./vault` export

### Updated (imports only)
- `src/view/react-context/global.tsx`
- `src/view/react-context/state.tsx`
- `src/view/react-context/settings.ts`
- `src/view/markdown-code-block/InlineMarkdownResults.tsx`
- `src/view/search/SearchModalContainer.tsx`
- `src/view/search/useUrlOpener.ts`
- `src/view/copy.ts`
- `src/obsidian-utils.ts`
- `package.json` (root)

---

## Layer 1: Core types and search

### Task 1: Add @mdtree/core workspace dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the dependency**

In `package.json`, add `@mdtree/core` to `dependencies`:

```json
"dependencies": {
    "@mdtree/core": "workspace:*",
    "graphology": "^0.25.4",
    "jotai": "^2.11.0",
    ...
}
```

- [ ] **Step 2: Install**

```bash
bun install
```

Expected: `@mdtree/core` symlinked into `node_modules/@mdtree/core`.

- [ ] **Step 3: Verify the export resolves**

```bash
node -e "require('./node_modules/@mdtree/core/src/index.ts')" 2>&1 | head -5
```

Expected: Either no output or a TS parse error (not "Cannot find module"). The symlink exists if no "Cannot find module" error appears.

---

### Task 2: Delete src/graph.ts and fix all its consumers

**Files:**
- Delete: `src/graph.ts`
- Modify: `src/view/react-context/global.tsx`
- Modify: `src/view/copy.ts`
- Modify: `src/view/search/useUrlOpener.ts`
- Modify: `src/obsidian-utils.ts`

- [ ] **Step 1: Delete src/graph.ts**

```bash
rm src/graph.ts
```

- [ ] **Step 2: Update src/view/react-context/global.tsx**

Replace:
```ts
import {NotesGraph} from "../../graph";
```
With:
```ts
import {NotesGraph} from "@mdtree/core";
```

- [ ] **Step 3: Update src/view/copy.ts**

Replace the entire file content:
```ts
export { reverseMarkdownParsing } from "@mdtree/core"
```

- [ ] **Step 4: Update src/view/search/useUrlOpener.ts**

Replace:
```ts
import { ParsedNode } from 'src/graph';
```
With:
```ts
import { ParsedNode } from '@mdtree/core';
```

- [ ] **Step 5: Update src/obsidian-utils.ts**

Replace:
```ts
import {Location} from "./graph";
```
With:
```ts
import {Location} from "@mdtree/core";
```

---

### Task 3: Delete search and query modules, fix all their consumers

**Files:**
- Delete: `src/search/search.ts`
- Delete: `src/search/query.ts`
- Delete: `src/indexing/parser.ts`
- Modify: `src/view/react-context/state.tsx`
- Modify: `src/view/markdown-code-block/InlineMarkdownResults.tsx`
- Modify: `src/view/search/SearchModalContainer.tsx`

- [ ] **Step 1: Delete the three source files**

```bash
rm src/search/search.ts src/search/query.ts src/indexing/parser.ts
```

- [ ] **Step 2: Update src/view/react-context/state.tsx — imports**

Replace the first two import lines:
```ts
import {advancedSearch, flattenTasks, ResultNode, searchIndex, searchParents, SearchQuery} from '../../search/search'
import {atom, useAtomValue} from 'jotai'
import {ParsedNode, ParsedTextToken, TextNode, TextTokenWithLocationLink} from '../../graph'
```
With:
```ts
import {advancedSearch, flattenTasks, ResultNode, searchIndex, searchParents} from '@mdtree/core'
import {atom, useAtomValue} from 'jotai'
import {ParsedNode, ParsedTextToken, TextNode, TextTokenWithLocationLink} from '@mdtree/core'

type SearchQuery = { query: string; file?: string; heading?: string }
```

- [ ] **Step 3: Update src/view/react-context/state.tsx — graph.graph usages**

There are four `graph.graph` references in `state.tsx`. Replace each:

Line ~67 (`advancedSearch`):
```ts
// Before
return advancedSearch(
    graph.graph,
    `[[${activeFile.basename}]]`.toLowerCase(),
    query,
    separator
)
// After
return advancedSearch(
    graph,
    `[[${activeFile.basename}]]`.toLowerCase(),
    query,
    separator
)
```

Line ~84 (`searchParents`):
```ts
// Before
return searchParents(graph.graph, activeFile)
// After
return searchParents(graph, activeFile.basename)
```

Line ~99 (`advancedSearch` in searchTasksAtom):
```ts
// Before
const searchResults = advancedSearch(
    graph.graph,
    `[[${activeFile.basename}]]`.toLowerCase(),
    query,
    separator
)
// After
const searchResults = advancedSearch(
    graph,
    `[[${activeFile.basename}]]`.toLowerCase(),
    query,
    separator
)
```

Line ~105 (`flattenTasks`):
```ts
// Before
return flattenTasks(searchResults).nodes
// After
return flattenTasks(searchResults)
```

Line ~135 (`searchIndex` in SearchModalMolecule):
```ts
// Before
const searchResults = searchIndex(graph.graph, search, separator)
// After
const searchResults = searchIndex(graph, search, separator)
```

Line ~214 (`searchPlaceholderAtom`):
```ts
// Before
return `Search ${graph.graph.nodes().length} nodes and ${graph.graph.edges().length} edges`
// After
return `Search ${graph.order} nodes and ${graph.size} edges`
```

- [ ] **Step 4: Update src/view/markdown-code-block/InlineMarkdownResults.tsx**

Replace:
```ts
import {advancedSearch, ResultNode, searchIndex} from "../../search/search";
```
With:
```ts
import {advancedSearch, ResultNode, searchIndex} from "@mdtree/core";
```

Replace both `graph.graph` references (lines ~38 and ~43):
```ts
// Before (line ~38)
const searchResults = searchIndex(graph.graph, `${settings.query} . ${query}`, separator)
// After
const searchResults = searchIndex(graph, `${settings.query} . ${query}`, separator)

// Before (line ~43)
const searchResults = advancedSearch(graph.graph, reference,
// After
const searchResults = advancedSearch(graph, reference,
```

- [ ] **Step 5: Update src/view/search/SearchModalContainer.tsx**

Replace:
```ts
import {advancedSearch, searchIndex} from "../../search/search";
```
With:
```ts
import {advancedSearch, searchIndex} from "@mdtree/core";
```

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors related to `src/graph`, `src/search/search`, `src/search/query`, or `src/indexing/parser`. Fix any remaining type errors before continuing.

- [ ] **Step 7: Commit Layer 1**

```bash
git add -A
git commit -m "refactor: replace local types and search with @mdtree/core (layer 1)"
```

---

## Layer 2: Vault indexer

### Task 4: Expose vault indexer from @mdtree/cli

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `package.json` (root)

- [ ] **Step 1: Add vault export to packages/cli/package.json**

Replace the entire file:
```json
{
  "name": "@mdtree/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "mdtree": "./src/main.ts"
  },
  "exports": {
    ".": "./src/main.ts",
    "./vault": "./src/vault/indexer.ts"
  },
  "scripts": {
    "dev": "bun run src/main.ts",
    "build": "bun build --compile --target=bun src/main.ts --outfile=../../dist/mdtree",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mdtree/core": "workspace:*",
    "chokidar": "^3.6.0",
    "commander": "^12.1.0",
    "ignore": "^7.0.5"
  },
  "devDependencies": {
    "@types/bun": "^1.3.12",
    "@types/node": "^20.0.0",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: Add @mdtree/cli to root package.json dependencies**

In `package.json`, add to `dependencies`:
```json
"dependencies": {
    "@mdtree/core": "workspace:*",
    "@mdtree/cli": "workspace:*",
    "graphology": "^0.25.4",
    ...
}
```

- [ ] **Step 3: Install**

```bash
bun install
```

Expected: `@mdtree/cli` symlinked into `node_modules/@mdtree/cli`.

---

### Task 5: Rewrite src/indexing/indexed-tree.ts

**Files:**
- Rewrite: `src/indexing/indexed-tree.ts`

- [ ] **Step 1: Replace the entire file**

```ts
import { NotesGraph } from "@mdtree/core"
import { buildGraph, reindexFile } from "@mdtree/cli/vault"
import { TFile, FileSystemAdapter } from "obsidian"
import { join } from "node:path"
import { getSettings } from "../view/react-context/settings"
import { GlobalAtoms, GlobalStore } from "../view/react-context/global"

export class IndexedTree {
    private graph: NotesGraph
    private isLoading = false
    private version = 0

    constructor(private store: GlobalStore) {
        this.graph = new NotesGraph()
    }

    private get vaultPath(): string {
        const adapter = this.store.get(GlobalAtoms.appAtom).vault.adapter
        if (!(adapter instanceof FileSystemAdapter)) {
            throw new Error("IndexedTree only works on desktop (FileSystemAdapter required)")
        }
        return adapter.basePath
    }

    async refresh(): Promise<void> {
        if (this.isLoading) return
        this.isLoading = true
        const settings = getSettings(this.store)
        const graph = await buildGraph(this.vaultPath, {
            parentRelation: settings.parentRelation,
            archiveTag: settings.archiveTag,
            searchSeparator: settings.searchSeparator,
        })
        this.setState(graph)
        this.isLoading = false
    }

    async refreshPage(file: TFile): Promise<void> {
        const absPath = join(this.vaultPath, file.path)
        const settings = getSettings(this.store)
        await reindexFile(absPath, this.vaultPath, this.graph, {
            parentRelation: settings.parentRelation,
            archiveTag: settings.archiveTag,
            searchSeparator: settings.searchSeparator,
        })
        this.setState(this.graph)
    }

    private setState(graph: NotesGraph): void {
        this.graph = graph
        this.store.set(GlobalAtoms.graphAtom, graph)
        this.store.set(GlobalAtoms.graphVersionAtom, ++this.version)
        this.store.set(GlobalAtoms.isGraphLoadingAtom, false)
    }
}
```

---

### Task 6: Delete old indexing files and update main.ts

**Files:**
- Delete: `src/indexing/markdown.ts`
- Delete: `src/indexing/canvas.ts`
- Delete: `src/indexing/text-parser.ts`
- Rewrite: `src/main.ts`

- [ ] **Step 1: Delete old indexing files**

```bash
rm src/indexing/markdown.ts src/indexing/canvas.ts src/indexing/text-parser.ts
```

- [ ] **Step 2: Rewrite src/main.ts**

Replace the entire file:

```ts
import {App, debounce, EventRef, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf} from 'obsidian';

import {SEARCH_VIEW, SearchViewPanel} from './view/search/SearchViewPanel';
import {QuickLinkModal} from './view/search-modal/link-selector/QuickLinkModal';

import {IndexedTree} from "./indexing/indexed-tree";
import {FILE_CONTEXT, FileContextView} from "./view/file-context/file-context";
import {ContextCodeBlock} from "./view/markdown-code-block/ContextCodeBlock";
import {SearchModal} from "./view/search-modal/SearchModal";
import {highlightLine, insertLine, moveToFolder, openFileByName, revealFolder, showFolder} from './obsidian-utils';
import {createStore} from 'jotai';
import {getSettings, updateSettings} from './view/react-context/settings';
import './view/styles.css';
import {GlobalAtoms} from "./view/react-context/global";
import {resetDefaultInjector} from "bunshi";

export default class TreeSearchPlugin extends Plugin {
    index: IndexedTree
    private changedRef: EventRef
    private finishedRef: EventRef;
    globalStore = createStore();
    private refreshInterval: number | null = null;

    async onunload() {
        console.log("Cleaning up after")
        this.globalStore = createStore()
        this.changedRef && this.app.metadataCache.offref(this.changedRef)
        this.finishedRef && this.app.metadataCache.offref(this.finishedRef)
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval)
        }
    }

    async onload() {
        resetDefaultInjector()
        this.globalStore = createStore()
        this.globalStore.set(GlobalAtoms.appAtom, this.app)

        this.index = new IndexedTree(this.globalStore);

        this.registerView(
            SEARCH_VIEW,
            (leaf) => new SearchViewPanel(leaf, this.globalStore)
        );

        this.registerView(
            FILE_CONTEXT,
            (leaf) => new FileContextView(leaf, this.globalStore)
        );

        this.addCommand({
            id: 'parse-tree',
            name: 'Search pane',
            callback: () => this.activateView(SEARCH_VIEW)
        });

        this.addCommand({
            id: 'file-context',
            name: 'File context',
            callback: () => this.activateView(FILE_CONTEXT)
        });

        const quickLinkModal = new QuickLinkModal(this.globalStore);
        quickLinkModal.setTitle("Insert Link");

        const searchModal = new SearchModal(this.globalStore);
        searchModal.setTitle("Search");

        this.addCommand({
            id: "quick-link-modal",
            name: "Quick Link",
            callback: () => {
                quickLinkModal.open();
            },
        });

        this.addCommand({
            id: "search-modal",
            name: "Search",
            callback: () => {
                searchModal.open();
            },
        });

        this.addCommand({
            id: 'Refresh-tree',
            name: 'Refresh',
            callback: () => {
                this.index.refresh()
                new Notice("Graph refreshed")
            }
        });

        this.addSettingTab(new SettingsTab(this.app, this));
        await this.loadSettings();

        const store = this.globalStore
        store.sub(GlobalAtoms.isGraphLoadingAtom, async () => {
            const reload = store.get(GlobalAtoms.isGraphLoadingAtom)
            if (reload) {
                console.debug("Graph refresh requested")
                await this.index.refresh()
            }
        })

        this.refreshInterval = setInterval(() => {
            const loading = store.get(GlobalAtoms.isGraphLoadingAtom)
            const graph = store.get(GlobalAtoms.graphAtom)
            if (!loading && graph.order === 0) store.set(GlobalAtoms.isGraphLoadingAtom, true)
        }, 2000, 5);

        const debouncer = debounce(async (file: TFile) => {
            await this.index.refreshPage(file)
        }, 200, true);

        this.registerEvent(this.app.vault.on('modify', async (file) => {
            if (file instanceof TFile) {
                debouncer(file)
            }
        }))

        this.registerMarkdownCodeBlockProcessor("tree-context", (source, element, context) => {
            context.addChild(new ContextCodeBlock(source, context, element, this.globalStore));
        });

        this.registerObsidianProtocolHandler("tree-search-uri", async (uri) => {
            const location = {
                path: uri.filepath,
                position: {
                    start: { line: parseInt(uri.sl), ch: parseInt(uri.sc) },
                    end: { line: parseInt(uri.el), ch: parseInt(uri.ec) }
                }
            }

            if (uri.raycastaction === "insert") {
                await insertLine(this.app, location)
            } else if (uri.raycastaction == "revealFolder") {
                await showFolder(this.app, uri.filepath)
            } if (uri.raycastaction == "open") {
                await openFileByName(this.app, uri.filepath + (uri.hash ? `#${uri.hash}` : ""))
            } else if (uri.raycastaction == "moveToFolder") {
                moveToFolder(this.app, uri.filepath)
            } else {
                await highlightLine(this.app, location)
            }
        })

        await this.index.refresh()

        return true
    }

    async activateView(viewType = SEARCH_VIEW) {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(viewType);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({ type: viewType, active: true });
            }
        }

        if (leaf) workspace.revealLeaf(leaf);

        setTimeout(() => {
            const inputEl = leaf?.view.containerEl.querySelector('input');
            inputEl?.select()
        }, 0);
    }

    async loadSettings() {
        updateSettings(this.globalStore, await this.loadData())
        await this.saveSettings();
    }

    async saveSettings() {
        await this.saveData(getSettings(this.globalStore));
    }
}

class SettingsTab extends PluginSettingTab {
    plugin: TreeSearchPlugin;

    constructor(app: App, plugin: TreeSearchPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const settings = getSettings(this.plugin.globalStore)
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Graph search separator')
            .setDesc('What you use to search between levels in the graph: e.g. `parent / child`')
            .addText(text => text
                .setPlaceholder('Search Separator')
                .setValue(settings.searchSeparator)
                .onChange(async (value) => {
                    settings.searchSeparator = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Parent relation')
            .setDesc('Frontmatter key that defines the parent relation')
            .addText(text => text
                .setPlaceholder('parent')
                .setValue(settings.parentRelation)
                .onChange(async (value) => {
                    settings.parentRelation = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Archive tag')
            .setDesc('Archive tag to ignore notes, lines or sections / headers')
            .addText(text => text
                .setPlaceholder('archive')
                .setValue(settings.archiveTag)
                .onChange(async (value) => {
                    settings.archiveTag = value;
                    await this.plugin.saveSettings();
                }));

        const div = containerEl.createDiv()
        div.setCssStyles({ fontStyle: "italic", borderTop: "1px solid #ddd" })
        const helpDesc = document.createDocumentFragment();
        helpDesc.append("v" + this.plugin.manifest.version, " • ");
        const strippedVersion = this.plugin.manifest.version.replace(/^v/, "").replace(/\./g, "");
        helpDesc.append(helpDesc.createEl("a", { href: "https://catacgc.github.io/tree-search-docs/ReleaseNotes#" + strippedVersion, text: "What's new" }))
        helpDesc.append(" • ");
        helpDesc.append(helpDesc.createEl("a", { href: "https://catacgc.github.io/tree-search-docs", text: "Documentation" }))
        helpDesc.append(" • ");
        helpDesc.append(helpDesc.createEl("a", { href: "https://github.com/catacgc/obsidian-tree-search", text: "Repo & Issue Reporting" }))
        div.append(helpDesc)
    }
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors. If `@mdtree/cli/vault` cannot be resolved, verify `packages/cli/package.json` has the `./vault` export and `bun install` was re-run.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: Build succeeds, `dist/main.js` produced.

- [ ] **Step 5: Commit Layer 2**

```bash
git add -A
git commit -m "refactor: replace vault indexer with buildGraph/reindexFile from @mdtree/cli (layer 2)"
```

---

## Layer 3: Raycast removal and dependency cleanup

### Task 7: Delete Raycast directory

**Files:**
- Delete: `src/view/raycast/raycast-server.ts`
- Delete: `src/view/raycast/raycast-response.ts`

- [ ] **Step 1: Delete the raycast directory**

```bash
rm -rf src/view/raycast/
```

- [ ] **Step 2: Remove RaycastServer from settings if referenced**

Check `src/view/react-context/settings.ts` for `socketPath`:

```bash
grep -n "socketPath" src/view/react-context/settings.ts
```

If `socketPath` exists in the settings type and atom, remove it. Open `src/view/react-context/settings.ts` and delete any `socketPath` field from the settings type, default value, and atom.

---

### Task 8: Remove graphology and obsidian-dataview dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove unused dependencies from package.json**

In `package.json`, remove from `dependencies`:
- `"graphology": "^0.25.4"`

In `package.json`, remove from `devDependencies`:
- `"obsidian-dataview": "^0.4.21"`

- [ ] **Step 2: Reinstall**

```bash
bun install
```

---

### Task 9: Final typecheck and build

- [ ] **Step 1: Typecheck**

```bash
npx tsc --noEmit
```

Expected: Zero errors.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: Build succeeds. Verify `dist/main.js` is produced and is smaller than before (no graphology bundled).

- [ ] **Step 3: Smoke test**

Load the plugin in Obsidian (copy `dist/main.js` and `dist/styles.css` to your test vault's `.obsidian/plugins/tree-search/`). Open the Search pane. Confirm:
- Graph loads (nodes visible in search)
- Search returns results
- File-context pane works
- The settings tab no longer shows "Raycast API socket path"

- [ ] **Step 4: Commit Layer 3**

```bash
git add -A
git commit -m "refactor: remove Raycast server and drop graphology/dataview deps (layer 3)"
```

---

## Self-Review Notes

**Spec coverage:**
- ✅ `src/graph.ts` deleted (Task 2)
- ✅ `src/search/` deleted (Task 3)
- ✅ `src/indexing/parser.ts`, `text-parser.ts` deleted (Task 3)
- ✅ `src/indexing/markdown.ts`, `canvas.ts` deleted (Task 6)
- ✅ `src/view/raycast/` deleted (Task 7)
- ✅ `IndexedTree` rewritten to use `buildGraph`/`reindexFile` (Task 5)
- ✅ `main.ts` removes Dataview gate and RaycastServer (Task 6)
- ✅ `@mdtree/cli` vault export added (Task 4)
- ✅ `graphology` and `obsidian-dataview` removed (Task 8)
- ✅ `graph.graph` → `graph` in `state.tsx` and `InlineMarkdownResults.tsx` (Task 3)
- ✅ `flattenTasks(x).nodes` → `flattenTasks(x)` (Task 3)
- ✅ `searchParents(graph.graph, file)` → `searchParents(graph, file.basename)` (Task 3)
- ✅ `graph.graph.nodes().length` → `graph.order`, `.edges().length` → `graph.size` (Task 3)
- ✅ `SearchQuery` type moved inline to `state.tsx` (Task 3)
- ✅ `FileSystemAdapter` used for typed vault path access (Task 5)
- ✅ Settings tab removes `socketPath` field (Task 7)
