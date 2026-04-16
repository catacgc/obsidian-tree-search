import { readFileSync } from "node:fs"
import { join, relative } from "node:path"
import ignore, { type Ignore } from "ignore"

/**
 * Read `.obsidianignore` from the vault root and return an `Ignore` instance.
 * If the file doesn't exist, returns an instance with no rules (ignores nothing).
 *
 * The format is identical to `.gitignore`: one glob pattern per line,
 * blank lines and `#` comments are ignored, leading `!` negates a pattern.
 */
export function loadObsidianIgnore(vaultRoot: string): Ignore {
  const ig = ignore()
  try {
    const content = readFileSync(join(vaultRoot, ".obsidianignore"), "utf-8")
    ig.add(content)
  } catch {
    // No .obsidianignore — ignore nothing extra
  }
  return ig
}

/**
 * Returns true if the given absolute path should be excluded according to the
 * ignore rules.  Paths are compared as vault-relative (forward-slash) strings.
 */
export function isIgnoredByObsidian(ig: Ignore, vaultRoot: string, absPath: string): boolean {
  // ignore package requires forward slashes and no leading slash
  const rel = relative(vaultRoot, absPath).replace(/\\/g, "/")
  if (!rel || rel.startsWith("..")) return false
  return ig.ignores(rel)
}
