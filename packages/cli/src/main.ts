#!/usr/bin/env bun
import { Command } from "commander"
import { runIndex } from "./commands/index.ts"
import { runWatch } from "./commands/watch.ts"
import { runServe } from "./commands/serve.ts"
import { runQuery } from "./commands/query.ts"
import { addPluginCommands } from "./commands/plugin.ts"

const program = new Command()
  .name("mdtree")
  .description("Standalone Obsidian vault indexer and search server")
  .version("0.1.0")
  .option(
    "--dir <path>",
    "Path to a vault directory (repeatable)",
    (v, acc: string[]) => [...acc, v],
    [] as string[],
  )

program
  .command("index")
  .description("Parse vault(s) and write the graph index to SQLite, then exit")
  .option("--out <path>", "SQLite output path (single vault only)")
  .action(async opts => {
    const dirs: string[] = program.opts().dir.length > 0 ? program.opts().dir : [process.cwd()]
    await runIndex({ dirs, out: opts.out })
  })

program
  .command("watch")
  .description("Index vault(s) and watch for file changes, updating the index incrementally")
  .option("--out <path>", "SQLite output path (single vault only)")
  .option("--fresh", "Ignore cached index and rebuild from scratch")
  .action(async opts => {
    const dirs: string[] = program.opts().dir.length > 0 ? program.opts().dir : [process.cwd()]
    await runWatch({ dirs, out: opts.out, fresh: opts.fresh })
  })

program
  .command("serve")
  .description("Index vault(s), watch for changes, and serve search over HTTP")
  .option("--out <path>", "SQLite output path (single vault only)")
  .option("--port <number>", "TCP port to serve on (default: Unix socket)", parseInt)
  .option("--fresh", "Ignore cached index and rebuild from scratch")
  .action(async opts => {
    const dirs: string[] = program.opts().dir.length > 0 ? program.opts().dir : [process.cwd()]
    await runServe({ dirs, out: opts.out, port: opts.port, fresh: opts.fresh })
  })

program
  .command("query <query>")
  .description("Search vault(s) directly from SQLite without a running server")
  .option("--limit <number>", "Max results to return", v => parseInt(v, 10), 100)
  .option("--out <path>", "SQLite path (single vault only)")
  .option("--json", "Output full JSON instead of plain text")
  .action(async (queryStr, opts) => {
    const dirs: string[] = program.opts().dir.length > 0 ? program.opts().dir : [process.cwd()]
    await runQuery({ dirs, queryStr, limit: opts.limit, out: opts.out, json: opts.json ?? false })
  })

addPluginCommands(program)

program.parseAsync(process.argv).catch(err => {
  console.error(err)
  process.exit(1)
})
