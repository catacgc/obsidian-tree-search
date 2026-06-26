import { readdir, stat } from "node:fs/promises"
import { join, extname } from "node:path"
import type { Dirent } from "node:fs"
import { loadObsidianIgnore, isIgnoredByObsidian } from "./obsidianignore.ts"

export type VaultFile = {
  path: string       // absolute path
  relativePath: string // vault-relative path
  mtime: number
  type: "markdown" | "canvas" | "attachment"
}

export type VaultFolder = {
  path: string
  relativePath: string
  name: string
}

export type WalkResult = {
  files: VaultFile[]
  folders: VaultFolder[]
}

const MD_EXTENSIONS = new Set([".md"])
const CANVAS_EXTENSIONS = new Set([".canvas"])
const IGNORED_DIRS = new Set([".git", ".obsidian", "node_modules", ".trash", ".stversions"])

function isIgnored(name: string): boolean {
  return IGNORED_DIRS.has(name) || name.startsWith(".")
}

function fileType(ext: string): VaultFile["type"] {
  if (MD_EXTENSIONS.has(ext)) return "markdown"
  if (CANVAS_EXTENSIONS.has(ext)) return "canvas"
  return "attachment"
}

const STAT_BATCH = 64

export async function walkVault(vaultRoot: string): Promise<WalkResult> {
  const files: VaultFile[] = []
  const folders: VaultFolder[] = []
  const ig = loadObsidianIgnore(vaultRoot)

  async function walk(dir: string, relDir: string): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    const subdirs: { absPath: string; relPath: string }[] = []
    const pendingFiles: { absPath: string; relPath: string; ext: string }[] = []

    for (const entry of entries) {
      const name = entry.name
      if (isIgnored(name)) continue

      const absPath = join(dir, name)
      const relPath = relDir ? `${relDir}/${name}` : name

      if (isIgnoredByObsidian(ig, vaultRoot, absPath)) continue

      if (entry.isDirectory()) {
        folders.push({ path: absPath, relativePath: relPath, name })
        subdirs.push({ absPath, relPath })
      } else if (entry.isFile()) {
        const ext = extname(name).toLowerCase()
        pendingFiles.push({ absPath, relPath, ext })
      }
    }

    // Batch stat for mtime in parallel
    for (let i = 0; i < pendingFiles.length; i += STAT_BATCH) {
      const batch = pendingFiles.slice(i, i + STAT_BATCH)
      const stats = await Promise.all(batch.map(f => stat(f.absPath).catch(() => null)))
      for (let j = 0; j < batch.length; j++) {
        const s = stats[j]
        if (!s) continue
        const f = batch[j]
        files.push({
          path: f.absPath,
          relativePath: f.relPath,
          mtime: s.mtimeMs,
          type: fileType(f.ext),
        })
      }
    }

    // Recurse into subdirectories in parallel
    await Promise.all(subdirs.map(d => walk(d.absPath, d.relPath)))
  }

  await walk(vaultRoot, "")
  return { files, folders }
}
