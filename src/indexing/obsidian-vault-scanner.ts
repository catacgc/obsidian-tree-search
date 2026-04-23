import { Vault, MetadataCache, TFile } from "obsidian"
import type { VaultScanner, WalkResult } from "@mdtree/core"

export class ObsidianVaultScanner implements VaultScanner {
  constructor(private vault: Vault, private metadataCache: MetadataCache) {}

  async walkVault(): Promise<WalkResult> {
    const isIgnored = this.metadataCache.isUserIgnored?.bind(this.metadataCache)
    const files = this.vault.getFiles()
      .filter(f => !isIgnored?.(f.path))
      .map(f => ({
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
