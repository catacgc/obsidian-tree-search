import { resolve, basename } from "node:path"
import { existsSync, rmSync } from "node:fs"
import { Command } from "commander"
import {
  listInstalledPlugins,
  getInstalledPlugin,
  unregisterPlugin,
  installFromPath,
  installFromGitHub,
  loadPluginMeta,
} from "../plugins/registry.ts"
import { promptAllFields } from "../plugins/prompt.ts"
import { runPluginAndIndex } from "../plugins/trigger.ts"
import { VaultStore, defaultDbPath } from "../store/sqlite.ts"
import { DEFAULT_SETTINGS, NotesGraph } from "@mdtree/core"

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStore(vaultOpt: string): { store: VaultStore; vaultName: string } {
  const vaultRoot = resolve(vaultOpt)
  const vaultName = basename(vaultRoot)
  const dbPath = defaultDbPath(vaultName)
  const store = new VaultStore(dbPath)
  return { store, vaultName }
}

// ── plugin install ────────────────────────────────────────────────────────────

async function runInstall(source: string) {
  try {
    let installed

    if (source.startsWith("github:")) {
      const spec = source.slice("github:".length)
      console.log(`Installing from GitHub: ${spec} ...`)
      installed = await installFromGitHub(spec)
    } else {
      const absPath = resolve(source)
      if (!existsSync(absPath)) {
        console.error(`Path not found: ${absPath}`)
        process.exit(1)
      }
      console.log(`Installing from: ${absPath} ...`)
      installed = installFromPath(absPath)
    }

    console.log(
      `Installed "${installed.name}" (${installed.namespace}) v${installed.version}`,
    )
    console.log(`  Run: mdtree --dir <vault> plugin config ${installed.namespace}`)
  } catch (err) {
    console.error(`Install failed: ${(err as Error).message}`)
    process.exit(1)
  }
}

// ── plugin list ───────────────────────────────────────────────────────────────

function runList(vaultOpt: string | undefined) {
  const installed = listInstalledPlugins()

  if (installed.length === 0) {
    console.log("No plugins installed.")
    console.log("  Install one: mdtree plugin install <path|github:owner/repo>")
    return
  }

  let vaultConfigs: { namespace: string; enabled: boolean; outputPath: string | null }[] = []
  if (vaultOpt) {
    const { store, vaultName } = getStore(vaultOpt)
    vaultConfigs = store.listPluginConfigs(vaultName)
    store.close()
  }

  const enabledMap = new Map(vaultConfigs.map(c => [c.namespace, c.enabled]))
  const outputMap = new Map(vaultConfigs.map(c => [c.namespace, c.outputPath]))

  console.log(`\n${"NAME".padEnd(20)} ${"NAMESPACE".padEnd(20)} ${"VERSION".padEnd(10)} STATUS     OUTPUT`)
  console.log("─".repeat(100))
  for (const p of installed) {
    const vaultStatus = vaultOpt
      ? (enabledMap.get(p.namespace) ?? true) ? "enabled " : "disabled"
      : "(no vault)"
    const output = outputMap.get(p.namespace) ?? "(not yet run)"
    console.log(
      `${p.name.padEnd(20)} ${p.namespace.padEnd(20)} ${p.version.padEnd(10)} ${vaultStatus}  ${output}`,
    )
  }
  console.log()
}

// ── plugin config ─────────────────────────────────────────────────────────────

async function runConfig(namespace: string, vaultOpt: string) {
  const plugin = getInstalledPlugin(namespace)
  if (!plugin) {
    console.error(`Plugin not found: ${namespace}`)
    console.error(`  Run: mdtree plugin list`)
    process.exit(1)
  }

  const meta = await loadPluginMeta(plugin)
  if (!meta || meta.fields.length === 0) {
    console.log(`Plugin "${namespace}" has no configurable fields.`)
    return
  }

  const { store, vaultName } = getStore(vaultOpt)
  const current = store.getPluginConfig(vaultName, namespace)

  console.log(`\nConfiguring ${plugin.name} for vault "${vaultName}"`)
  console.log("Press Enter to keep the current value.\n")

  const secretNames = meta.fields.filter(f => f.secret).map(f => f.name)
  const safeDisplay = { ...current.configValues }
  for (const k of secretNames) {
    if (safeDisplay[k]) safeDisplay[k] = "****"
  }

  const updated = await promptAllFields(meta.fields, current.configValues)

  store.setPluginConfig(vaultName, namespace, { enabled: current.enabled, configValues: updated })
  store.close()

  console.log(`\nConfig saved for ${namespace} in vault "${vaultName}".`)
}

// ── plugin run ────────────────────────────────────────────────────────────────

async function runRun(name: string | undefined, vaultOpt: string) {
  const vaultRoot = resolve(vaultOpt)
  const vaultName = basename(vaultRoot)

  const plugins = name
    ? (getInstalledPlugin(name) ? [getInstalledPlugin(name)!] : [])
    : listInstalledPlugins()

  if (name && plugins.length === 0) {
    console.error(`Plugin not found: ${name}`)
    process.exit(1)
  }
  if (plugins.length === 0) {
    console.log("No plugins installed.")
    return
  }

  const store = new VaultStore(defaultDbPath(vaultName))
  const graph = new NotesGraph()
  store.loadIntoGraph(vaultName, graph)

  let ran = 0
  for (const plugin of plugins) {
    const indexed = await runPluginAndIndex(
      plugin,
      vaultRoot,
      vaultName,
      graph,
      DEFAULT_SETTINGS,
      store,
    )
    if (indexed) ran++
    else if (name) {
      console.log(`Plugin "${plugin.namespace}" is disabled for vault "${vaultName}" or produced no output.`)
    }
  }

  store.close()
  console.log(`Done — ${ran} plugin(s) indexed into vault "${vaultName}".`)
}

// ── plugin remove ─────────────────────────────────────────────────────────────

function runRemove(namespace: string, vaultOpt: string | undefined) {
  const removed = unregisterPlugin(namespace)
  if (!removed) {
    console.error(`Plugin not found: ${namespace}`)
    process.exit(1)
  }

  // Remove output file from the vault if we know where it is
  if (vaultOpt) {
    const { store, vaultName } = getStore(vaultOpt)
    const configs = store.listPluginConfigs(vaultName)
    const entry = configs.find(c => c.namespace === namespace)
    if (entry?.outputPath && existsSync(entry.outputPath)) {
      rmSync(entry.outputPath)
      console.log(`  Removed output file: ${entry.outputPath}`)
    }
    store.close()
  }

  console.log(`Removed plugin: ${removed.name} (${namespace})`)
  console.log(`  Plugin files remain at: ${removed.installPath}`)
  console.log(`  Delete manually if no longer needed.`)
}

// ── plugin enable / disable ───────────────────────────────────────────────────

function runSetEnabled(namespace: string, vaultOpt: string, enabled: boolean) {
  const plugin = getInstalledPlugin(namespace)
  if (!plugin) {
    console.error(`Plugin not found: ${namespace}`)
    process.exit(1)
  }
  const { store, vaultName } = getStore(vaultOpt)
  store.setPluginEnabled(vaultName, namespace, enabled)
  store.close()
  console.log(`Plugin "${namespace}" ${enabled ? "enabled" : "disabled"} for vault "${vaultName}".`)
}

// ── Command builder (attached to main program) ────────────────────────────────

export function addPluginCommands(program: Command): void {
  // Plugin commands target vault(s) via the global --dir option (repeatable,
  // like index/query). Falls back to the current directory when no --dir is given.
  const dirs = (): string[] => {
    const d = program.opts().dir as string[]
    return d.length > 0 ? d : [process.cwd()]
  }

  const plugin = program
    .command("plugin")
    .description("Manage mdtree plugins (target vault(s) via the global --dir option)")

  plugin
    .command("install <source>")
    .description("Install a plugin from a local path or github:owner/repo")
    .action(runInstall)

  plugin
    .command("list")
    .description("List installed plugins and their status in the --dir vault")
    .action(() => runList(dirs()[0]))

  plugin
    .command("config <name>")
    .description("Configure a plugin for the --dir vault (interactive)")
    .action(name => runConfig(name, dirs()[0]))

  plugin
    .command("run [name]")
    .description("Run a plugin (or all enabled plugins) now and reindex its output")
    .action(async name => {
      for (const dir of dirs()) await runRun(name, dir)
    })

  plugin
    .command("remove <name>")
    .description("Uninstall a plugin globally (and remove its output from the --dir vault)")
    .action(name => runRemove(name, dirs()[0]))

  plugin
    .command("enable <name>")
    .description("Enable a plugin for the --dir vault(s)")
    .action(name => {
      for (const dir of dirs()) runSetEnabled(name, dir, true)
    })

  plugin
    .command("disable <name>")
    .description("Disable a plugin for the --dir vault(s)")
    .action(name => {
      for (const dir of dirs()) runSetEnabled(name, dir, false)
    })
}
