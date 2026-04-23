# Design: Mobile VaultScanner Abstraction

## New Types & Interface (`@mdtree/core`)

**`packages/core/src/graph/scanner.ts`** (new file)

```typescript
export type VaultFile = {
  path: string      // vault-relative, e.g. "folder/note.md"
  mtime: number     // milliseconds
  type: "markdown" | "canvas" | "attachment"
}

export type VaultFolder = {
  path: string      // vault-relative, e.g. "folder/sub"
  name: string      // basename only, e.g. "sub"
}

export type WalkResult = {
  files: VaultFile[]
  folders: VaultFolder[]
}

export interface VaultScanner {
  walkVault(): Promise<WalkResult>
  readFile(relPath: string): Promise<{ content: string; mtime: number }>
}
```

`VaultFile`, `VaultFolder`, `WalkResult` are moved here from `packages/cli/src/vault/walker.ts`
(currently those types are local to the CLI). The CLI's walker becomes an internal implementation
detail of `NodeVaultScanner`.

---

## Core Builder Functions (`@mdtree/core`)

**`packages/core/src/graph/builder.ts`** (new file)

Extracts the orchestration loop from `packages/cli/src/vault/indexer.ts`. Calls only existing
pure core functions — no I/O of its own.

```typescript
export async function buildGraphFromScanner(
  scanner: VaultScanner,
  settings?: IndexSettings
): Promise<NotesGraph>

export async function reindexFileInGraph(
  relPath: string,
  graph: NotesGraph,
  scanner: VaultScanner,
  settings: IndexSettings
): Promise<void>
```

### `buildGraphFromScanner` logic

```
1. scanner.walkVault() → { files, folders }
2. For each folder:
     graph.createFolderNode(folder.path, folder.name, location)
3. For each file:
     { content, mtime } = await scanner.readFile(file.path)
     ext = extname(file.path)   ← node:path NOT needed, use .split(".").pop()
     if .md:
       page = parseVaultFile(content, file.path, mtime, settings.archiveTag)
       indexSinglePage(page, graph, settings)
     if .canvas:
       parseCanvasData(file.path, basename, JSON.parse(content), graph)
     else (attachment):
       graph.addAttachmentNode(name, ext, file.path, mtime)
```

Note: the path operations (`extname`, `basename`) that previously came from `node:path` are
replaced with simple string operations (`.split(".")`, `.split("/")`) — these are trivial and
avoid any node: dependency in core.

### `reindexFileInGraph` logic

```
1. graph.removeByPath(relPath)
2. { content, mtime } = await scanner.readFile(relPath)
3. (same parsing branch as buildGraphFromScanner for a single file)
```

---

## Node Implementation (`@mdtree/cli`)

**`packages/cli/src/vault/node-scanner.ts`** (new file)

```typescript
import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { VaultScanner, WalkResult } from "@mdtree/core"
import { walkVault } from "./walker.ts"   // existing walker stays as-is

export class NodeVaultScanner implements VaultScanner {
  constructor(private vaultRoot: string) {}

  async walkVault(): Promise<WalkResult> {
    const result = await walkVault(this.vaultRoot)
    // walker.ts already produces the same shape — map to core types
    return {
      files: result.files.map(f => ({
        path: f.relativePath,    // walker has both abs and relative
        mtime: f.mtime,
        type: f.type,
      })),
      folders: result.folders.map(f => ({
        path: f.relativePath,
        name: f.name,
      })),
    }
  }

  async readFile(relPath: string): Promise<{ content: string; mtime: number }> {
    const abs = join(this.vaultRoot, relPath)
    const [content, s] = await Promise.all([readFile(abs, "utf-8"), stat(abs)])
    return { content, mtime: s.mtimeMs }
  }
}
```

**`packages/cli/src/vault/indexer.ts`** (updated)

```typescript
export async function buildGraph(vaultRoot: string, settings?: IndexSettings) {
  return buildGraphFromScanner(new NodeVaultScanner(vaultRoot), settings)
}

export async function reindexFile(
  absPath: string,
  vaultRoot: string,
  graph: NotesGraph,
  settings: IndexSettings,
  store?: VaultStore,
  vault?: string
) {
  const relPath = relative(vaultRoot, absPath)
  await reindexFileInGraph(relPath, graph, new NodeVaultScanner(vaultRoot), settings)
  // SQLite persistence (store/vault args) stays here, unchanged
}
```

Public API is identical — no changes to CLI commands or tests.

---

## Obsidian Implementation (`src/`)

**`src/indexing/obsidian-vault-scanner.ts`** (new file)

```typescript
import { Vault, TFile } from "obsidian"
import { VaultScanner, WalkResult } from "@mdtree/core"

export class ObsidianVaultScanner implements VaultScanner {
  constructor(private vault: Vault) {}

  async walkVault(): Promise<WalkResult> {
    const files = this.vault.getFiles().map(f => ({
      path: f.path,
      mtime: f.stat.mtime,
      type: fileType(f.extension),
    }))
    const folders = this.vault.getAllFolders(false).map(f => ({
      path: f.path,
      name: f.name,
    }))
    return { files, folders }
  }

  async readFile(relPath: string): Promise<{ content: string; mtime: number }> {
    const file = this.vault.getFileByPath(relPath)
    if (!file) throw new Error(`[mdtree] File not found in vault: ${relPath}`)
    return { content: await this.vault.cachedRead(file), mtime: file.stat.mtime }
  }
}

function fileType(ext: string): "markdown" | "canvas" | "attachment" {
  if (ext === "md") return "markdown"
  if (ext === "canvas") return "canvas"
  return "attachment"
}
```

Key: `TFile.path` is vault-relative, `vault.getFiles()` covers the whole vault recursively,
and `vault.cachedRead()` is mobile-safe. No `node:*` imports, no `FileSystemAdapter`.

---

## Updated `IndexedTree` (`src/indexing/indexed-tree.ts`)

Removes:
- `import { buildGraph, reindexFile } from "@mdtree/cli/vault"`
- `import { join } from "node:path"`
- `import { FileSystemAdapter } from "obsidian"` (and the `vaultPath` getter)

Adds:
- `import { buildGraphFromScanner, reindexFileInGraph } from "@mdtree/core"`
- `import { ObsidianVaultScanner } from "./obsidian-vault-scanner"`

```typescript
async refresh(): Promise<void> {
  ...
  const graph = await buildGraphFromScanner(
    new ObsidianVaultScanner(this.store.get(GlobalAtoms.appAtom).vault),
    settings
  )
  ...
}

async refreshPage(file: TFile): Promise<void> {
  ...
  await reindexFileInGraph(
    file.path,   // already vault-relative in Obsidian
    this.graph,
    new ObsidianVaultScanner(this.store.get(GlobalAtoms.appAtom).vault),
    settings
  )
  ...
}
```

---

## File Summary

| File | Action |
|------|--------|
| `packages/core/src/graph/scanner.ts` | New — VaultScanner interface + WalkResult types |
| `packages/core/src/graph/builder.ts` | New — buildGraphFromScanner, reindexFileInGraph |
| `packages/core/src/index.ts` | Export scanner + builder symbols |
| `packages/cli/src/vault/node-scanner.ts` | New — NodeVaultScanner wrapping walker.ts |
| `packages/cli/src/vault/indexer.ts` | Thin-wrap over NodeVaultScanner + core functions |
| `src/indexing/obsidian-vault-scanner.ts` | New — ObsidianVaultScanner via app.vault |
| `src/indexing/indexed-tree.ts` | Swap cli/vault imports for core + ObsidianVaultScanner |

`esbuild.config.mjs` — no changes needed.
