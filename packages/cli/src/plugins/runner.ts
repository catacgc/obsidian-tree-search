import { mkdirSync } from "node:fs"
import { join } from "node:path"
import type { InstalledPlugin, VaultPluginConfig } from "./types.ts"

/** Vault-relative folder that holds one generated note per plugin. */
export const PLUGIN_OUTPUT_DIR = "Apps"

/** Turns a plugin namespace into a title-cased note name, e.g. "arc" -> "Arc". */
function outputFileName(namespace: string): string {
  return namespace
    .split("-")
    .map(part => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join("-")
}

/**
 * Runs a plugin subprocess, passing config as JSON on stdin.
 * The plugin writes Markdown to stdout, which is saved to the output path.
 *
 * Returns the absolute path to the generated Markdown file, or null on failure.
 */
export async function runPlugin(
  plugin: InstalledPlugin,
  config: VaultPluginConfig,
  vaultRoot: string,
): Promise<string | null> {
  const entrypoint = join(plugin.installPath, plugin.entrypoint)
  // Write into a normal vault folder (not a dot-dir) so the note is visible to
  // Obsidian and picked up by regular vault scans. One note per plugin.
  const outputDir = join(vaultRoot, PLUGIN_OUTPUT_DIR)
  const outputPath = join(outputDir, `${outputFileName(plugin.namespace)}.md`)

  mkdirSync(outputDir, { recursive: true })

  const proc = Bun.spawn(["bun", "run", entrypoint], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: plugin.installPath,
  })

  const configJson = JSON.stringify(config.configValues)
  proc.stdin.write(configJson)
  proc.stdin.end()

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (stderr.trim()) {
    console.warn(`[plugin:${plugin.namespace}] ${stderr.trim()}`)
  }

  if (exitCode !== 0) {
    console.error(`[plugin:${plugin.namespace}] exited with code ${exitCode}`)
    return null
  }

  await Bun.write(outputPath, stdout)
  return outputPath
}
