/**
 * MockVaultScanner wraps an in-memory vault map (path -> content)
 * and implements the VaultScanner interface for I/O-free benchmarking.
 */

import type { VaultScanner, VaultFile, VaultFolder, WalkResult } from "@mdtree/core"

const FIXED_MTIME = 1700000000000

export class MockVaultScanner implements VaultScanner {
  private vaultMap: Record<string, string>

  constructor(vaultMap: Record<string, string>) {
    this.vaultMap = vaultMap
  }

  async walkVault(): Promise<WalkResult> {
    const files: VaultFile[] = []
    const folderSet = new Set<string>()

    for (const path of Object.keys(this.vaultMap)) {
      // Determine file type from extension
      const ext = path.slice(path.lastIndexOf(".")).toLowerCase()
      let type: VaultFile["type"]
      if (ext === ".md") {
        type = "markdown"
      } else if (ext === ".canvas") {
        type = "canvas"
      } else {
        type = "attachment"
      }

      files.push({ path, mtime: FIXED_MTIME, type })

      // Extract folder paths from file path
      const parts = path.split("/")
      for (let i = 1; i < parts.length; i++) {
        folderSet.add(parts.slice(0, i).join("/"))
      }
    }

    const folders: VaultFolder[] = Array.from(folderSet)
      .sort()
      .map(p => ({
        path: p,
        name: p.split("/").pop()!,
      }))

    return { files, folders }
  }

  async readFile(relPath: string): Promise<{ content: string; mtime: number }> {
    const content = this.vaultMap[relPath]
    if (content === undefined) {
      throw new Error(`MockVaultScanner: file not found: ${relPath}`)
    }
    return { content, mtime: FIXED_MTIME }
  }
}
