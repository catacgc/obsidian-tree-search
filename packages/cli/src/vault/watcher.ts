import chokidar from "chokidar"
import { stat } from "node:fs/promises"
import { extname } from "node:path"
import { loadObsidianIgnore, isIgnoredByObsidian } from "./obsidianignore.ts"

export type ChangeEvent = {
  type: "add" | "change" | "unlink"
  path: string       // absolute path
  mtime: number      // 0 for unlink
}

export type WatcherOptions = {
  debounceMs?: number
  ignored?: (string | RegExp)[]
}

const DEFAULT_IGNORED = [
  /[/\\]\./,           // dotfiles / dotdirs
  /node_modules/,
  /\.obsidian/,
  /\.trash/,
]

/**
 * Watch a vault directory and emit debounced change events.
 * Respects `.obsidianignore` if present.
 */
export function watchVault(
  vaultRoot: string,
  onChange: (event: ChangeEvent) => void,
  opts: WatcherOptions = {},
): () => void {
  const debounceMs = opts.debounceMs ?? 200
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const ig = loadObsidianIgnore(vaultRoot)

  function emit(event: ChangeEvent): void {
    const existing = timers.get(event.path)
    if (existing) clearTimeout(existing)
    timers.set(
      event.path,
      setTimeout(() => {
        timers.delete(event.path)
        onChange(event)
      }, debounceMs),
    )
  }

  // Combine the static ignore list with .obsidianignore rules
  const baseIgnored = opts.ignored ?? DEFAULT_IGNORED
  const ignoredFn = (absPath: string): boolean =>
    isIgnoredByObsidian(ig, vaultRoot, absPath)

  const watcher = chokidar.watch(vaultRoot, {
    ignored: [...(baseIgnored as (string | RegExp)[]), ignoredFn],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  })

  watcher.on("add", async (path: string) => {
    const mtime = await getMtime(path)
    emit({ type: "add", path, mtime })
  })

  watcher.on("change", async (path: string) => {
    const mtime = await getMtime(path)
    emit({ type: "change", path, mtime })
  })

  watcher.on("unlink", (path: string) => {
    emit({ type: "unlink", path, mtime: 0 })
  })

  return () => {
    watcher.close()
    for (const t of timers.values()) clearTimeout(t)
  }
}

async function getMtime(path: string): Promise<number> {
  try {
    const s = await stat(path)
    return s.mtimeMs
  } catch {
    return Date.now()
  }
}
