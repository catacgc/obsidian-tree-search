import { readFile } from "node:fs/promises"
import { join } from "node:path"
import moment from "moment"
import { makePeriodicDateResolver, type MomentParse, type PeriodicNoteConfig } from "@mdtree/core"

// Strict moment parse for the periodic-note resolver. `moment` matches the token
// set Obsidian uses (gggg, ww, MMM, ...), keeping CLI ages in sync with the app.
const momentParse: MomentParse = (input, format) => {
  const m = moment(input, format, true)
  return m.isValid() ? m.valueOf() : null
}

async function readJson(path: string): Promise<Record<string, any> | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8"))
  } catch {
    return null
  }
}

// Read the core "Daily Notes" plugin setting (.obsidian/daily-notes.json). We
// deliberately do NOT depend on the community "Periodic Notes" plugin.
async function loadConfigs(vaultRoot: string): Promise<PeriodicNoteConfig[]> {
  const daily = await readJson(join(vaultRoot, ".obsidian", "daily-notes.json"))
  if (!daily) return []
  return [{ folder: daily.folder ?? "", format: daily.format || "YYYY-MM-DD" }]
}

// Cache resolvers per vault root so long-lived watch/serve processes read the
// `.obsidian` config once rather than on every incremental reindex.
const resolverCache = new Map<string, (path: string) => number | null>()

export async function getPeriodicResolver(vaultRoot: string): Promise<(path: string) => number | null> {
  const cached = resolverCache.get(vaultRoot)
  if (cached) return cached
  const resolver = makePeriodicDateResolver(await loadConfigs(vaultRoot), momentParse)
  resolverCache.set(vaultRoot, resolver)
  return resolver
}
