#!/usr/bin/env bun
import { Command } from "commander"
import { runIndex } from "./commands/index.ts"
import { runWatch } from "./commands/watch.ts"
import { runServe } from "./commands/serve.ts"
import { addPluginCommands } from "./commands/plugin.ts"

const program = new Command()
  .name("mdtree")
  .description("Standalone Obsidian vault indexer and search server")
  .version("0.1.0")

program
  .command("index")
  .description("Parse the vault and write the graph index to SQLite, then exit")
  .option("--vault <path>", "Path to the Obsidian vault", process.cwd())
  .option("--out <path>", "SQLite output path (default: ~/.config/mdtree/<vault>.db)")
  .action(async opts => {
    await runIndex({ vault: opts.vault, out: opts.out })
  })

program
  .command("watch")
  .description("Index the vault and watch for file changes, updating the index incrementally")
  .option("--vault <path>", "Path to the Obsidian vault", process.cwd())
  .option("--out <path>", "SQLite output path (default: ~/.config/mdtree/<vault>.db)")
  .option("--fresh", "Ignore cached index and rebuild from scratch")
  .action(async opts => {
    await runWatch({ vault: opts.vault, out: opts.out, fresh: opts.fresh })
  })

program
  .command("serve")
  .description("Index vault(s), watch for changes, and serve search over HTTP")
  .option(
    "--vault <path>",
    "Path to an Obsidian vault (repeatable for multi-vault)",
    (v, acc: string[]) => [...acc, v],
    [] as string[],
  )
  .option(
    "--out <path>",
    "SQLite output path (default: ~/.config/mdtree/<vault>.db per vault)",
  )
  .option("--port <number>", "TCP port to serve on (default: Unix socket)", parseInt)
  .option("--fresh", "Ignore cached index and rebuild from scratch")
  .action(async opts => {
    // If no --vault given, default to cwd
    const vaults: string[] = opts.vault.length > 0 ? opts.vault : [process.cwd()]
    await runServe({ vaults, out: opts.out, port: opts.port, fresh: opts.fresh })
  })

addPluginCommands(program)

program.parseAsync(process.argv).catch(err => {
  console.error(err)
  process.exit(1)
})
