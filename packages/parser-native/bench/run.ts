/**
 * Benchmark runner for the Rust/WASM parser vs TypeScript parser.
 *
 * Measures:
 * - Parse-phase-only (parseBatchChunk) — asymmetric comparison
 * - Full indexing (buildGraphFromScanner) — apples-to-apples comparison
 * - Incremental single-file reindex (parseVaultFile)
 * - WASM boundary crossing validation (zero per-list-item crossings)
 *
 * Usage: bun run packages/parser-native/bench/run.ts
 */

import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

import { TsParserProvider, buildGraphFromScanner, type FileInput } from "@mdtree/core"
import { loadNativeParser, NativeParserProvider } from "../ts/index.ts"
import { generateVault } from "./generate-vault.ts"
import { MockVaultScanner } from "./mock-scanner.ts"
import { CountingProviderWrapper } from "./counting-provider.ts"

// ── Utility functions ──────────────────────────────────────────────────────────

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function formatMs(ms: number): string {
  return ms.toFixed(1)
}

function formatSpeedup(tsMs: number, wasmMs: number): string {
  if (wasmMs === 0) return "N/A"
  return (tsMs / wasmMs).toFixed(2) + "x"
}

function padRight(str: string, len: number): string {
  return str + " ".repeat(Math.max(0, len - str.length))
}

function padLeft(str: string, len: number): string {
  return " ".repeat(Math.max(0, len - str.length)) + str
}

// ── Main benchmark ─────────────────────────────────────────────────────────────

async function main() {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)

  // 1. Load WASM
  const wasmPath = resolve(__dirname, "../pkg/parser_native_bg.wasm")
  const wasmBytes = readFileSync(wasmPath)
  const handle = await loadNativeParser(wasmBytes)
  const nativeProvider = new NativeParserProvider(handle)
  const tsProvider = new TsParserProvider()

  const settings = { parentRelation: "parent", archiveTag: "archive", searchSeparator: "." }
  const chunkSize = 50

  // 2. Generate synthetic vaults
  console.log("Generating synthetic vaults...")
  const vault1k = generateVault({ fileCount: 1000 })
  const vault2k = generateVault({ fileCount: 2000 })
  console.log(`  1k vault: ${Object.keys(vault1k).length} files`)
  console.log(`  2k vault: ${Object.keys(vault2k).length} files`)
  console.log("")

  // Helper: prepare FileInput[] from vault map
  function prepareFileInputs(vault: Record<string, string>): FileInput[] {
    return Object.entries(vault).map(([path, content]) => ({
      path,
      content,
      mtime: 1700000000000,
      archiveTag: "archive",
    }))
  }

  // ── Parse-phase benchmark (batch) ────────────────────────────────────────────

  type ParseResult = { tsMs: number; wasmMs: number }
  const parseResults: Record<string, ParseResult> = {}

  for (const [label, vault] of [["1k", vault1k], ["2k", vault2k]] as const) {
    const files = prepareFileInputs(vault as Record<string, string>)

    // Warmup iteration (discarded)
    tsProvider.parseBatchChunk(files)
    nativeProvider.parseBatchChunk(files)

    // Timed iterations
    const tsTimes: number[] = []
    const wasmTimes: number[] = []

    for (let iter = 0; iter < 3; iter++) {
      const tsStart = performance.now()
      tsProvider.parseBatchChunk(files)
      tsTimes.push(performance.now() - tsStart)

      const wasmStart = performance.now()
      nativeProvider.parseBatchChunk(files)
      wasmTimes.push(performance.now() - wasmStart)
    }

    parseResults[label] = { tsMs: median(tsTimes), wasmMs: median(wasmTimes) }
  }

  // ── Full indexing benchmark ──────────────────────────────────────────────────

  type IndexResult = { tsMs: number; wasmMs: number; tsNodes: number; wasmNodes: number; tsEdges: number; wasmEdges: number }
  const indexResults: Record<string, IndexResult> = {}

  for (const [label, vault] of [["1k", vault1k], ["2k", vault2k]] as const) {
    const scanner = new MockVaultScanner(vault as Record<string, string>)

    // Warmup iteration (discarded)
    await buildGraphFromScanner(scanner, settings, tsProvider, chunkSize)
    await buildGraphFromScanner(scanner, settings, nativeProvider, chunkSize)

    // Timed iterations
    const tsTimes: number[] = []
    const wasmTimes: number[] = []
    let tsNodes = 0, wasmNodes = 0, tsEdges = 0, wasmEdges = 0

    for (let iter = 0; iter < 3; iter++) {
      const tsStart = performance.now()
      const tsGraph = await buildGraphFromScanner(scanner, settings, tsProvider, chunkSize)
      tsTimes.push(performance.now() - tsStart)
      if (iter === 0) { tsNodes = tsGraph.order; tsEdges = tsGraph.size }

      const wasmStart = performance.now()
      const wasmGraph = await buildGraphFromScanner(scanner, settings, nativeProvider, chunkSize)
      wasmTimes.push(performance.now() - wasmStart)
      if (iter === 0) { wasmNodes = wasmGraph.order; wasmEdges = wasmGraph.size }
    }

    indexResults[label] = {
      tsMs: median(tsTimes),
      wasmMs: median(wasmTimes),
      tsNodes,
      wasmNodes,
      tsEdges,
      wasmEdges,
    }
  }

  // ── Incremental single-file reindex ──────────────────────────────────────────

  const firstPath = Object.keys(vault2k)[0]
  const firstContent = vault2k[firstPath]

  // Warmup
  tsProvider.parseVaultFile(firstContent, firstPath, 1700000000000, "archive")
  nativeProvider.parseVaultFile(firstContent, firstPath, 1700000000000, "archive")

  const tsSingleTimes: number[] = []
  const wasmSingleTimes: number[] = []

  for (let iter = 0; iter < 10; iter++) {
    const tsStart = performance.now()
    tsProvider.parseVaultFile(firstContent, firstPath, 1700000000000, "archive")
    tsSingleTimes.push(performance.now() - tsStart)

    const wasmStart = performance.now()
    nativeProvider.parseVaultFile(firstContent, firstPath, 1700000000000, "archive")
    wasmSingleTimes.push(performance.now() - wasmStart)
  }

  const singleResult = { tsMs: median(tsSingleTimes), wasmMs: median(wasmSingleTimes) }

  // ── WASM boundary crossing validation ────────────────────────────────────────

  const countingProvider = new CountingProviderWrapper(nativeProvider)
  const scanner2k = new MockVaultScanner(vault2k)
  await buildGraphFromScanner(scanner2k, settings, countingProvider, chunkSize)
  const counts = countingProvider.getCounts()

  const expectedBatchCalls = Math.ceil(2000 / chunkSize)

  let assertionsFailed = false

  if (counts.parseTokensCalls !== 0) {
    console.error(`ASSERTION FAILED: parseTokensCalls = ${counts.parseTokensCalls}, expected 0`)
    assertionsFailed = true
  }
  if (counts.batchChunkCalls !== expectedBatchCalls) {
    console.error(`ASSERTION FAILED: batchChunkCalls = ${counts.batchChunkCalls}, expected ${expectedBatchCalls}`)
    assertionsFailed = true
  }
  if (counts.parseVaultFileCalls !== 0) {
    console.error(`ASSERTION FAILED: parseVaultFileCalls = ${counts.parseVaultFileCalls}, expected 0`)
    assertionsFailed = true
  }

  // Graph equivalence check
  for (const [label, result] of Object.entries(indexResults)) {
    if (result.tsNodes !== result.wasmNodes) {
      console.error(`ASSERTION FAILED: graph.order mismatch for ${label} vault: TS=${result.tsNodes}, WASM=${result.wasmNodes}`)
      assertionsFailed = true
    }
    if (result.tsEdges !== result.wasmEdges) {
      console.error(`ASSERTION FAILED: graph.size mismatch for ${label} vault: TS=${result.tsEdges}, WASM=${result.wasmEdges}`)
      assertionsFailed = true
    }
  }

  // ── Format and print results ─────────────────────────────────────────────────

  console.log("=== WASM Parser Benchmark Results ===")
  console.log("")
  console.log("NOTE: Parse-phase (batch) comparison is ASYMMETRIC:")
  console.log("  - WASM parseBatchChunk: frontmatter + scan + inline tokens for EVERY list item (full parse)")
  console.log("  - TS parseBatchChunk: frontmatter + scan only (inline tokens computed later in indexSinglePage)")
  console.log("  Full indexing is the apples-to-apples comparison (same total work, same graph output).")
  console.log("")

  // Timing table
  const rows = [
    { label: "Parse-phase 1k notes (batch)*", ts: parseResults["1k"].tsMs, wasm: parseResults["1k"].wasmMs },
    { label: "Parse-phase 2k notes (batch)*", ts: parseResults["2k"].tsMs, wasm: parseResults["2k"].wasmMs },
    { label: "Full index 1k notes", ts: indexResults["1k"].tsMs, wasm: indexResults["1k"].wasmMs },
    { label: "Full index 2k notes", ts: indexResults["2k"].tsMs, wasm: indexResults["2k"].wasmMs },
    { label: "Incremental single file", ts: singleResult.tsMs, wasm: singleResult.wasmMs },
  ]

  console.log("| " + padRight("Benchmark", 34) + "| " + padLeft("TS (ms)", 10) + " | " + padLeft("WASM (ms)", 10) + " | " + padLeft("Speedup", 8) + " |")
  console.log("|" + "-".repeat(35) + "|" + "-".repeat(12) + "|" + "-".repeat(12) + "|" + "-".repeat(10) + "|")
  for (const row of rows) {
    console.log(
      "| " + padRight(row.label, 34) +
      "| " + padLeft(formatMs(row.ts), 10) + " " +
      "| " + padLeft(formatMs(row.wasm), 10) + " " +
      "| " + padLeft(formatSpeedup(row.ts, row.wasm), 8) + " |"
    )
  }
  console.log("")
  console.log("* Parse-phase rows show asymmetric workloads (see note above)")
  console.log("")

  // Graph equivalence table
  console.log("=== Graph Equivalence ===")
  console.log("| " + padRight("Vault Size", 12) + "| " + padLeft("TS nodes", 10) + " | " + padLeft("WASM nodes", 11) + " | " + padLeft("TS edges", 10) + " | " + padLeft("WASM edges", 11) + " | " + padLeft("Match", 6) + " |")
  console.log("|" + "-".repeat(13) + "|" + "-".repeat(12) + "|" + "-".repeat(13) + "|" + "-".repeat(12) + "|" + "-".repeat(13) + "|" + "-".repeat(8) + "|")
  for (const [label, result] of Object.entries(indexResults)) {
    const match = result.tsNodes === result.wasmNodes && result.tsEdges === result.wasmEdges ? "✓" : "✗"
    console.log(
      "| " + padRight(label, 12) +
      "| " + padLeft(String(result.tsNodes), 10) + " " +
      "| " + padLeft(String(result.wasmNodes), 11) + " " +
      "| " + padLeft(String(result.tsEdges), 10) + " " +
      "| " + padLeft(String(result.wasmEdges), 11) + " " +
      "| " + padLeft(match, 6) + " |"
    )
  }
  console.log("")

  // Boundary crossing table
  console.log("=== WASM Boundary Crossings (2k vault, batch flow) ===")
  console.log("| " + padRight("Metric", 25) + "| " + padLeft("Count", 8) + " |")
  console.log("|" + "-".repeat(26) + "|" + "-".repeat(10) + "|")
  console.log("| " + padRight("parseBatchChunk calls", 25) + "| " + padLeft(String(counts.batchChunkCalls), 8) + " |")
  console.log("| " + padRight("parseTokens calls", 25) + "| " + padLeft(String(counts.parseTokensCalls), 8) + " |")
  console.log("| " + padRight("parseVaultFile calls", 25) + "| " + padLeft(String(counts.parseVaultFileCalls), 8) + " |")
  console.log("| " + padRight("Total files in batches", 25) + "| " + padLeft(String(counts.totalFilesInBatches), 8) + " |")
  console.log("")

  if (assertionsFailed) {
    console.error("BENCHMARK FAILED: One or more assertions did not pass.")
    process.exit(1)
  } else {
    console.log("All assertions passed.")
  }
}

main().catch(err => {
  console.error("Benchmark error:", err)
  process.exit(1)
})
