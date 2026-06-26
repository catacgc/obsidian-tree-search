import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { VaultScanner, WalkResult, VaultFile } from "@mdtree/core"
import { walkVault } from "./walker.ts"

export class NodeVaultScanner implements VaultScanner {
  private mtimeMap: Map<string, number> | undefined

  constructor(private vaultRoot: string) {}

  async walkVault(): Promise<WalkResult> {
    const result = await walkVault(this.vaultRoot)
    this.mtimeMap = new Map<string, number>()
    const files: VaultFile[] = new Array(result.files.length)
    for (let i = 0; i < result.files.length; i++) {
      const f = result.files[i]
      files[i] = { path: f.relativePath, mtime: f.mtime, type: f.type }
      this.mtimeMap.set(f.relativePath, f.mtime)
    }
    return {
      files,
      folders: result.folders.map(f => ({ path: f.relativePath, name: f.name })),
    }
  }

  async readFile(relPath: string): Promise<{ content: string; mtime: number }> {
    const abs = join(this.vaultRoot, relPath)
    const content = await readFile(abs, "utf-8")
    const mtime = this.mtimeMap?.get(relPath) ?? 0
    return { content, mtime }
  }
}
