import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { join } from "node:path"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { VaultStore } from "../store/sqlite.ts"
import { buildGraph } from "../vault/indexer.ts"
import { runQuery } from "../commands/query.ts"

let vaultDir: string
let dbPath: string
const VAULT_NAME = "test-vault"

beforeAll(async () => {
  // Create a temp dir that acts as a vault
  vaultDir = mkdtempSync(join(tmpdir(), "mdtree-query-vault-"))
  writeFileSync(join(vaultDir, "work.md"), "# tasks\n- Buy groceries\n- Write report\n")

  dbPath = join(tmpdir(), `mdtree-query-test-${Date.now()}.db`)

  const graph = await buildGraph(vaultDir)
  const store = new VaultStore(dbPath)
  store.saveGraph(VAULT_NAME, graph)
  store.close()
})

afterAll(() => {
  rmSync(vaultDir, { recursive: true })
  try { rmSync(dbPath) } catch {}
})

describe("runQuery", () => {
  it("returns matching results as plain text lines to stdout", async () => {
    const lines: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    // @ts-ignore
    process.stdout.write = (chunk: string) => { lines.push(chunk); return true }

    await runQuery({ dirs: [vaultDir], queryStr: "tasks", limit: 100, out: dbPath, json: false })

    // @ts-ignore
    process.stdout.write = origWrite

    const output = lines.join("")
    expect(output).toContain("tasks")
  })

  it("returns JSON array when --json flag is set", async () => {
    let output = ""
    const origWrite = process.stdout.write.bind(process.stdout)
    // @ts-ignore
    process.stdout.write = (chunk: string) => { output += chunk; return true }

    await runQuery({ dirs: [vaultDir], queryStr: "tasks", limit: 100, out: dbPath, json: true })

    // @ts-ignore
    process.stdout.write = origWrite

    const parsed = JSON.parse(output)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBeGreaterThan(0)
    expect(parsed[0]).toHaveProperty("node")
  })
})
