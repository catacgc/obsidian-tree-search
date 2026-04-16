import { readdir, stat } from "node:fs/promises"
import { join, extname } from "node:path"
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

/**
 * Recursively walk a vault directory.
 * Returns all files (with metadata) and all folders.
 * Respects `.obsidianignore` if present.
 */
export async function walkVault(vaultRoot: string): Promise<WalkResult> {
  const files: VaultFile[] = []
  const folders: VaultFolder[] = []
  const ig = loadObsidianIgnore(vaultRoot)

  async function walk(dir: string, relDir: string): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }

    for (const entry of entries) {
      if (isIgnored(entry)) continue

      const absPath = join(dir, entry)
      const relPath = relDir ? `${relDir}/${entry}` : entry

      if (isIgnoredByObsidian(ig, vaultRoot, absPath)) continue

      let s
      try {
        s = await stat(absPath)
      } catch {
        continue
      }

      if (s.isDirectory()) {
        folders.push({
          path: absPath,
          relativePath: relPath,
          name: entry,
        })
        await walk(absPath, relPath)
      } else if (s.isFile()) {
        const ext = extname(entry).toLowerCase()
        files.push({
          path: absPath,
          relativePath: relPath,
          mtime: s.mtimeMs,
          type: fileType(ext),
        })
      }
    }
  }

  await walk(vaultRoot, "")
  return { files, folders }
}
