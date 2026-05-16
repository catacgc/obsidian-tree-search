# Behavioral Spec: rust-parser-08-benchmarks

## ADDED Requirements

### Requirement: The benchmark harness SHALL generate synthetic vaults of configurable size with representative markdown content

The synthetic vault generator SHALL produce in-memory markdown file maps containing frontmatter, headers, list items with obsidian links, markdown links, inline tags, tasks, meta-actions, and nested children — providing a realistic workload for parser performance measurement.

#### Scenario: Generate a 2000-note synthetic vault

- **Given** the vault generator is invoked with `fileCount: 2000` and `itemsPerFile: 20`
- **When** the vault is generated
- **Then** exactly 2000 file entries are produced in the output map
- **And** each file contains approximately 20 list items distributed under 2-3 headers
- **And** at least 60% of files contain frontmatter with tags and/or aliases
- **And** at least 30% of files contain a `parent: "[[...]]"` frontmatter field
- **And** at least 50% of list items contain obsidian `[[link]]` syntax

#### Scenario: Generate a 1000-note synthetic vault

- **Given** the vault generator is invoked with `fileCount: 1000`
- **When** the vault is generated
- **Then** exactly 1000 file entries are produced in the output map
- **And** all files are parseable by both TS and WASM parsers without errors

#### Scenario: Deterministic generation

- **Given** the vault generator is invoked twice with identical parameters
- **When** both vaults are generated
- **Then** the output maps are identical (same file paths, same content)

---

### Requirement: The benchmark runner SHALL measure parse-phase-only performance for both TS and WASM parsers

The runner MUST time the `parseBatchChunk` call for both `TsParserProvider` and `NativeParserProvider` on identical vault content, reporting the speedup ratio.

#### Scenario: Batch parse-phase benchmark at 2000 notes

- **Given** a synthetic vault of 2000 notes has been generated
- **And** both `TsParserProvider` and `NativeParserProvider` are instantiated
- **When** `parseBatchChunk` is called with all 2000 files for each provider (3 iterations each)
- **Then** the median parse times for both providers are reported
- **And** a speedup ratio (TS time / WASM time) is computed and displayed

#### Scenario: Batch parse-phase benchmark at 1000 notes

- **Given** a synthetic vault of 1000 notes has been generated
- **When** `parseBatchChunk` is called with all 1000 files for each provider
- **Then** the median parse times and speedup ratio are reported

---

### Requirement: The benchmark runner SHALL measure full-indexing performance including graph construction

The runner MUST time `buildGraphFromScanner` end-to-end (including graph construction) for both providers on identical vault content.

#### Scenario: Full indexing benchmark at 2000 notes

- **Given** a synthetic vault of 2000 notes and a MockVaultScanner wrapping it
- **And** both providers are available
- **When** `buildGraphFromScanner(scanner, settings, provider)` is called for each provider (3 iterations each)
- **Then** the median full-indexing times and speedup ratio are reported
- **And** the resulting graphs from both providers have the same node count (structural equivalence)

---

### Requirement: The benchmark runner SHALL measure incremental single-file reindex performance

The runner MUST time the parse phase of a single-file reindex for both providers to validate the 2x speedup target for incremental updates.

#### Scenario: Incremental single-file parse benchmark

- **Given** a single file from the 2000-note vault is selected
- **When** `parseVaultFile(content, path, mtime, archiveTag)` is called for each provider (10 iterations each)
- **Then** the median single-file parse times and speedup ratio are reported

---

### Requirement: The benchmark harness SHALL count and validate WASM boundary crossings during batch indexing

The harness MUST wrap the native provider in a counting proxy and assert that zero individual `parseTokens` WASM calls are made for markdown files during batch-flow graph construction.

#### Scenario: Zero per-list-item WASM crossings in batch flow

- **Given** a `CountingProviderWrapper` wraps the `NativeParserProvider`
- **And** a 2000-note synthetic vault is prepared
- **When** `buildGraphFromScanner(scanner, settings, countingProvider)` completes
- **Then** `countingProvider.parseTokensCalls` equals only the number of canvas-related calls (zero if no canvas files in the synthetic vault)
- **And** `countingProvider.batchChunkCalls` equals `ceil(2000 / chunkSize)`
- **And** `countingProvider.parseVaultFileCalls` equals 0

#### Scenario: Boundary crossing report is printed

- **Given** the counting benchmark has completed
- **When** results are formatted
- **Then** a table showing `parseBatchChunk calls`, `parseTokens calls`, `parseVaultFile calls`, and `total files in batches` is printed to stdout

---

### Requirement: The benchmark MUST be runnable via package.json scripts

The benchmark harness MUST be invocable via standard project scripts without requiring manual setup beyond having the WASM artifact built.

#### Scenario: Run benchmark from root

- **Given** the WASM artifact exists at `packages/parser-native/pkg/parser_native_bg.wasm`
- **When** `bun run bench` is executed from the project root
- **Then** the benchmark runs to completion and prints results to stdout without errors

#### Scenario: Run benchmark from parser-native package

- **Given** the WASM artifact exists
- **When** `bun run bench` is executed from `packages/parser-native/`
- **Then** the benchmark runs to completion and prints results to stdout without errors
