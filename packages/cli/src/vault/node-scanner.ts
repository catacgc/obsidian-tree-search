import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import type { VaultScanner, WalkResult } from "@mdtree/core"
import { walkVault } from "./walker.ts"

export class NodeVaultScanner implements VaultScanner {
  constructor(private vaultRoot: string) {}

  async walkVault(): Promise<WalkResult> {
    const result = await walkVault(this.vaultRoot)
    return {
      files: result.files.map(f => ({
        path: f.relativePath,
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
