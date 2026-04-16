import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, cpSync, rmSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { InstalledPlugin, PluginManifest, FieldDef } from "./types.ts"

// ── Paths ─────────────────────────────────────────────────────────────────────

export function pluginsInstallDir(): string {
  const dir = join(homedir(), ".config", "mdtree", "plugins")
  mkdirSync(dir, { recursive: true })
  return dir
}

const registryFile = () => join(homedir(), ".config", "mdtree", "plugins.json")

// ── Registry I/O ──────────────────────────────────────────────────────────────

function loadRegistry(): InstalledPlugin[] {
  const file = registryFile()
  if (!existsSync(file)) return []
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as InstalledPlugin[]
  } catch {
    return []
  }
}

function saveRegistry(plugins: InstalledPlugin[]): void {
  writeFileSync(registryFile(), JSON.stringify(plugins, null, 2))
}

// ── Public API ────────────────────────────────────────────────────────────────

export function listInstalledPlugins(): InstalledPlugin[] {
  return loadRegistry()
}

export function getInstalledPlugin(namespace: string): InstalledPlugin | undefined {
  return loadRegistry().find(p => p.namespace === namespace)
}

export function registerPlugin(plugin: InstalledPlugin): void {
  const all = loadRegistry().filter(p => p.namespace !== plugin.namespace)
  all.push(plugin)
  saveRegistry(all)
}

export function unregisterPlugin(namespace: string): InstalledPlugin | undefined {
  const all = loadRegistry()
  const plugin = all.find(p => p.namespace === namespace)
  if (!plugin) return undefined
  saveRegistry(all.filter(p => p.namespace !== namespace))
  return plugin
}

// ── Install from local path ───────────────────────────────────────────────────

export function installFromPath(sourcePath: string): InstalledPlugin {
  const manifestPath = join(sourcePath, "plugin.json")
  if (!existsSync(manifestPath)) {
    throw new Error(`No plugin.json found at ${sourcePath}`)
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as PluginManifest
  validateManifest(manifest)

  const dest = join(pluginsInstallDir(), manifest.namespace)
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true })
  }
  cpSync(sourcePath, dest, { recursive: true })

  const installed: InstalledPlugin = {
    ...manifest,
    installPath: dest,
    installedAt: Date.now(),
  }
  registerPlugin(installed)
  return installed
}

// ── Install from GitHub ───────────────────────────────────────────────────────

export async function installFromGitHub(spec: string): Promise<InstalledPlugin> {
  // spec format: owner/repo or owner/repo/subpath
  const parts = spec.split("/")
  if (parts.length < 2) {
    throw new Error(`Invalid GitHub spec "${spec}" — expected owner/repo or owner/repo/subpath`)
  }

  const [owner, repo, ...subpathParts] = parts
  const cloneUrl = `https://github.com/${owner}/${repo}.git`
  const tmpDir = join(homedir(), ".config", "mdtree", ".tmp-install")

  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })

  const cloneDir = join(tmpDir, repo)
  const cloneProc = Bun.spawnSync(["git", "clone", "--depth=1", cloneUrl, cloneDir])
  if (cloneProc.exitCode !== 0) {
    const stderr = cloneProc.stderr?.toString() ?? ""
    throw new Error(`git clone failed: ${stderr}`)
  }

  const pluginDir = subpathParts.length > 0 ? join(cloneDir, subpathParts.join("/")) : cloneDir
  const installed = installFromPath(pluginDir)

  rmSync(tmpDir, { recursive: true, force: true })
  return installed
}

// ── Load plugin field definitions ─────────────────────────────────────────────

export interface PluginSchemaMeta {
  fields: FieldDef[]
}

export async function loadPluginMeta(plugin: InstalledPlugin): Promise<PluginSchemaMeta | null> {
  const schemaPath = join(plugin.installPath, "config.schema.ts")
  if (!existsSync(schemaPath)) return null
  try {
    const mod = await import(schemaPath)
    const fields = mod.fields as FieldDef[] | undefined
    return { fields: fields ?? [] }
  } catch (err) {
    console.warn(`[plugin:${plugin.namespace}] failed to load config schema:`, err)
    return null
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateManifest(m: Partial<PluginManifest>): asserts m is PluginManifest {
  for (const key of ["namespace", "name", "version", "entrypoint"] as const) {
    if (!m[key]) throw new Error(`plugin.json is missing required field: ${key}`)
  }
  if (!/^[a-z0-9-]+$/.test(m.namespace!)) {
    throw new Error(`plugin namespace must be lowercase alphanumeric with dashes: "${m.namespace}"`)
  }
}
