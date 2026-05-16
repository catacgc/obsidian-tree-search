# Behavioral Spec: rust-parser-08-benchmarks

## ADDED Requirements

### Requirement: The benchmark harness SHALL generate synthetic vaults of configurable size with representative markdown content

The synthetic vault generator SHALL produce in-memory markdown file maps containing frontmatter, headers, list items with obsidian links, markdown links, HTTP URLs, inline tags, tasks, meta-actions, and nested children — providing a realistic workload for parser performance measurement.

#### Scenario: Generate a 2000-note synthetic vault

- **Given** the vault generator is invoked with `fileCount: 2000` and `itemsPerFile: 20`
- **When** the vault is generated
- **Then** exactly 2000 file entries MUST be produced in the output map
- **And** each file MUST contain approximately 20 list items distributed under 2-3 headers
- **And** at least 60% of files MUST contain frontmatter with tags and/or aliases
- **And** at least 30% of files MUST contain a `parent: "[[...]]"` frontmatter field
- **And** at least 50% of list items MUST contain obsidian `[[link]]` syntax

#### Scenario: Generate a 1000-note synthetic vault

- **Given** the vault generator is invoked with `fileCount: 1000`
- **When** the vault is generated
- **Then** exactly 1000 file entries MUST be produced in the output map
- **And** all files MUST be parseable by both TS and WASM parsers without errors

#### Scenario: Deterministic generation

- **Given** the vault generator is invoked twice with identical parameters
- **When** both vaults are generated
- **Then** the output maps MUST be identical (same file paths, same content)

---

### Requirement: The benchmark runner SHALL measure parse-phase-only performance for both TS and WASM parsers with documented workload asymmetry

The runner MUST time the `parseBatchChunk` call for both `TsParserProvider` and `NativeParserProvider` on identical vault content, reporting the speedup ratio. The runner MUST document in its output that the comparison is asymmetric: `NativeParserProvider.parseBatchChunk` pre-computes inline tokens for every list item and frontmatter parent string (~20x more computation per file), while `TsParserProvider.parseBatchChunk` only does frontmatter extraction and markdown scanning.

#### Scenario: Batch parse-phase benchmark at 2000 notes

- **Given** a synthetic vault of 2000 notes has been generated
- **And** both `TsParserProvider` and `NativeParserProvider` are instantiated
- **When** one warmup iteration (discarded) is run for each provider
- **And** `parseBatchChunk` is called with all 2000 files for each provider (3 timed iterations each)
- **Then** the median parse times for both providers MUST be reported
- **And** a speedup ratio (TS time / WASM time) MUST be computed and displayed
- **And** the output MUST include a note that this comparison is asymmetric

#### Scenario: Batch parse-phase benchmark at 1000 notes

- **Given** a synthetic vault of 1000 notes has been generated
- **When** one warmup iteration is run and `parseBatchChunk` is called for each provider
- **Then** the median parse times and speedup ratio MUST be reported

---

### Requirement: The benchmark runner SHALL measure full-indexing performance including graph construction as the primary apples-to-apples metric

The runner MUST time `buildGraphFromScanner` end-to-end (including graph construction) for both providers on identical vault content. This is the equivalent-work comparison because the TS path's inline token computation occurs inside `indexSinglePage` after `parseBatchChunk` while the WASM path pre-computes them during `parseBatchChunk`.

#### Scenario: Full indexing benchmark at 2000 notes

- **Given** a synthetic vault of 2000 notes and a MockVaultScanner wrapping it
- **And** both providers are available
- **When** one warmup iteration (discarded) is run for each provider
- **And** `buildGraphFromScanner(scanner, settings, provider)` is called for each provider (3 timed iterations each)
- **Then** the median full-indexing times and speedup ratio MUST be reported
- **And** the resulting graphs from both providers MUST have the same node count (`graph.order`)
- **And** the resulting graphs from both providers MUST have the same edge count (`graph.size`)

#### Scenario: Full indexing benchmark at 1000 notes

- **Given** a synthetic vault of 1000 notes and a MockVaultScanner wrapping it
- **When** one warmup iteration is run and `buildGraphFromScanner` is called for each provider
- **Then** the median full-indexing times and speedup ratio MUST be reported
- **And** graph node count and edge count MUST match between providers

---

### Requirement: The benchmark runner SHALL measure incremental single-file reindex performance

The runner MUST time the parse phase of a single-file reindex for both providers to validate the 2x speedup target for incremental updates.

#### Scenario: Incremental single-file parse benchmark

- **Given** a single file from the 2000-note vault is selected
- **When** one warmup iteration (discarded) is run for each provider
- **And** `parseVaultFile(content, path, mtime, archiveTag)` is called for each provider (10 timed iterations each)
- **Then** the median single-file parse times and speedup ratio MUST be reported

---

### Requirement: The benchmark harness SHALL count and validate WASM boundary crossings during batch indexing

The harness MUST wrap the native provider in a counting proxy and assert that zero individual `parseTokens` WASM calls are made for markdown files during batch-flow graph construction. This validates the `precomputedTokens` design that collapses ~40,000 potential WASM calls into zero.

#### Scenario: Zero per-list-item WASM crossings in batch flow

- **Given** a `CountingProviderWrapper` wraps the `NativeParserProvider`
- **And** a 2000-note synthetic vault is prepared (no canvas files)
- **When** `buildGraphFromScanner(scanner, settings, countingProvider)` completes
- **Then** `countingProvider.parseTokensCalls` MUST equal 0
- **And** `countingProvider.batchChunkCalls` MUST equal `Math.ceil(2000 / chunkSize)` (default chunkSize=50, so 40)
- **And** `countingProvider.parseVaultFileCalls` MUST equal 0
- **And** `countingProvider.totalFilesInBatches` MUST equal 2000

#### Scenario: Boundary crossing report is printed

- **Given** the counting benchmark has completed
- **When** results are formatted
- **Then** a table showing `parseBatchChunk calls`, `parseTokens calls`, `parseVaultFile calls`, and `total files in batches` MUST be printed to stdout

---

### Requirement: The benchmark MUST be runnable via package.json scripts

The benchmark harness MUST be invocable via standard project scripts without requiring manual setup beyond having the WASM artifact built.

#### Scenario: Run benchmark from root

- **Given** the WASM artifact exists at `packages/parser-native/pkg/parser_native_bg.wasm`
- **When** `bun run bench` is executed from the project root
- **Then** the benchmark MUST run to completion and print results to stdout without errors

#### Scenario: Run benchmark from parser-native package

- **Given** the WASM artifact exists
- **When** `bun run bench` is executed from `packages/parser-native/`
- **Then** the benchmark MUST run to completion and print results to stdout without errors
