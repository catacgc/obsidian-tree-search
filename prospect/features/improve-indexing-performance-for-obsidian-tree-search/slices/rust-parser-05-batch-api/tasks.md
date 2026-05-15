# Tasks: rust-parser-05-batch-api

## Task 1 — Create shared Rust output types for batch API

**Create `packages/parser-native/src/types.rs`:**

Define serde-serializable output structures that mirror the `DvPage` JSON shape produced by `parseVaultFile` in TypeScript:

- `BatchFileInput` (with `Deserialize`): `path: String`, `content: String`, `mtime: f64`, `archive_tag: String` (with `#[serde(rename = "archiveTag")]`).
- `BatchParsedPage`: `file: BatchFileInfo`, `headers: Vec<HeadingCacheItem>`, `precomputed_parent_tokens: HashMap<String, Vec<ParsedToken>>` (serialized as `precomputedParentTokens`).
- `BatchFileInfo`: `aliases: AliasesWrapper`, `name: String`, `mtime: MtimeWrapper`, `path: String`, `frontmatter: serde_json::Value`, `lists: ListsWrapper`, `tags: Vec<String>`.
- `AliasesWrapper`: `values: Vec<String>`.
- `MtimeWrapper`: `ts: f64`.
- `ListsWrapper`: `values: Vec<BatchDvListItem>`.
- `BatchDvListItem`: Same fields as `DvListItem` from `list_scanner.rs` (link, text, raw_text, line, position, parent, children as `Vec<BatchDvListItem>`, tags, section, task, completed) PLUS `precomputed_tokens: Vec<ParsedToken>` (serialized as `precomputedTokens`). The `children` field is also `Vec<BatchDvListItem>` to carry nested tokens.

Use `#[serde(rename_all = "camelCase")]` on all structs. Import types from `crate::frontmatter`, `crate::list_scanner`, and `crate::inline_tokens` as needed.

**Modify `packages/parser-native/src/lib.rs`:**
- Add `mod types;` declaration.

**Verification:** `cargo check` passes.

---

## Task 2 — Implement `batch_parse_chunk` and `parse_single_file` Rust functions

**Add batch parsing logic (in `lib.rs` or a separate `batch.rs` module referenced from `lib.rs`):**

Implement a private `fn process_single_file(input: &BatchFileInput) -> BatchParsedPage` that:

1. Calls `frontmatter::parse_frontmatter(&input.content)` → gets `frontmatter` (a `serde_json::Value`) and `body_start`.
2. Extracts `name` from `input.path`: split on `'/'`, take last segment, strip `.md` suffix.
3. Extracts `aliases` from frontmatter: if `frontmatter["aliases"]` is an array of strings → use them; if a single string → wrap in vec; otherwise → empty vec.
4. Extracts `tags` from frontmatter: same logic as aliases but on `frontmatter["tags"]`.
5. Calls `list_scanner::scan_markdown(&input.content, &input.path, body_start, &input.archive_tag)` → gets `ScanResult { lists, headers }`.
6. Converts `Vec<DvListItem>` to `Vec<BatchDvListItem>` by calling `inline_tokens::parse_tokens(&item.raw_text)` for each item and attaching as `precomputed_tokens`. Recursively converts children too.
7. Filters to root items only (`parent == None`) for `file.lists.values` — children are already nested.
8. Computes `precomputed_parent_tokens: HashMap<String, Vec<ParsedToken>>` by scanning all frontmatter values: for any string value containing `"[["`, call `inline_tokens::parse_tokens(value)` and insert into the map. For array values, check each element string.
9. Assembles and returns `BatchParsedPage`.

**Add `#[wasm_bindgen]` exports in `lib.rs`:**

```rust
#[wasm_bindgen]
pub fn batch_parse_chunk(json_input: &str) -> String {
    let inputs: Vec<BatchFileInput> = serde_json::from_str(json_input)
        .unwrap_or_default();
    let results: Vec<BatchParsedPage> = inputs.iter()
        .map(|input| process_single_file(input))
        .collect();
    serde_json::to_string(&results)
        .unwrap_or_else(|_| "[]".to_string())
}

#[wasm_bindgen]
pub fn parse_single_file(content: &str, path: &str, mtime: f64, archive_tag: &str) -> String {
    let input = BatchFileInput {
        path: path.to_string(),
        content: content.to_string(),
        mtime,
        archive_tag: archive_tag.to_string(),
    };
    let result = process_single_file(&input);
    serde_json::to_string(&result)
        .unwrap_or_else(|_| r#"{"file":{"aliases":{"values":[]},"name":"","mtime":{"ts":0},"path":"","frontmatter":{},"lists":{"values":[]},"tags":[]},"headers":[],"precomputedParentTokens":{}}"#.to_string())
}
```

**Key detail:** The `ScanResult.lists` from `scan_markdown` already has children wired via the `wire_children` post-pass. However, `parseVaultFile` in TypeScript filters to `lists.filter(it => it.parent === undefined)` — so only root items go in the output. The `BatchDvListItem` must recursively carry `precomputedTokens` on children too, since `indexSinglePage` walks children recursively.

**Verification:** `cargo check` passes. `cargo test` existing tests still pass.

---

## Task 3 — Write Rust unit tests for batch logic

**Add tests in `packages/parser-native/src/` (either a `#[cfg(test)] mod tests` in the batch module or in `lib.rs`):**

Write ≥15 tests covering:

1. Batch with single simple file (frontmatter + one list item) → correct structure
2. Batch with multiple files → correct count, independent parsing
3. List items have `precomputed_tokens` populated matching `parse_tokens(raw_text)`
4. Root-only filtering: nested items appear in children, not at top-level `file.lists.values`
5. Children also have `precomputed_tokens` populated
6. `precomputed_parent_tokens` populated for frontmatter `parent: "[[Root]]"` → key `"[[Root]]"`, value matches `parse_tokens("[[Root]]")`
7. `precomputed_parent_tokens` populated for array parent `parent: ["[[A]]", "[[B]]"]` → two entries
8. `precomputed_parent_tokens` empty when no frontmatter values contain `[[`
9. Name extraction: `"folder/sub/my-note.md"` → `"my-note"`
10. Name extraction: `"simple.md"` → `"simple"`
11. Aliases extraction: array → correct vec; string → single-element vec; absent → empty
12. Tags extraction: array → correct vec; string → single-element vec; absent → empty
13. Empty file (no frontmatter, no list items) → valid empty structure with empty lists/headers
14. File with only frontmatter, no body → empty lists
15. Archive tag filtering: items with archive tag are excluded from list output
16. `parse_single_file` output matches single-element batch output
17. File with list items but no links/tags still produces correct `precomputed_tokens` (empty or text-only tokens)

**Verification:** `cargo test` passes all new tests (target ≥15, expect ~17).

---

## Task 4 — Extend `DvList` and `DvPage` types in `@mdtree/core`

**Modify `packages/core/src/graph/types.ts`:**

Add the optional `precomputedTokens` field to `DvList`:

```typescript
export type DvList = {
  link: { path: string }
  text: string
  rawText: string
  line: number
  position: {
    start: { line: number; col: number }
    end: { line: number; col: number }
  }
  parent?: number
  children: DvList[]
  tags: string[]
  section: { subpath: string }
  task: boolean
  completed: boolean
  /** Pre-computed inline tokens for rawText. Populated by native parser only. */
  precomputedTokens?: ParsedTextToken[]
}
```

Add the optional `precomputedParentTokens` field to `DvPage`:

```typescript
export type DvPage = {
  file: {
    aliases: { values: string[] }
    name: string
    mtime: { ts: number }
    path: string
    frontmatter: Record<string, unknown>
    lists: { values: DvList[] }
    tags: string[]
  }
  headers: HeadingCache[]
  /** Pre-computed tokens for frontmatter parent strings. Populated by native parser only. */
  precomputedParentTokens?: Map<string, ParsedTextToken[]>
}
```

**Verification:** `bun test packages/core` passes all existing tests unchanged.

---

## Task 5 — Implement `adaptBatchResult` and `adaptSingleResult` TypeScript adapter functions

**Modify `packages/parser-native/ts/adapter.ts`:**

Add new raw types for deserialization:

```typescript
type RawBatchDvListItem = RawDvListItem & {
  precomputedTokens: ParsedTextToken[]
}

type RawBatchParsedPage = {
  file: {
    aliases: { values: string[] }
    name: string
    mtime: { ts: number }
    path: string
    frontmatter: Record<string, unknown>
    lists: { values: RawBatchDvListItem[] }
    tags: string[]
  }
  headers: HeadingCache[]
  precomputedParentTokens: Record<string, ParsedTextToken[]>
}
```

Implement and export:

```typescript
export function adaptBatchResult(json: string): DvPage[] {
  const parsed = JSON.parse(json) as RawBatchParsedPage[]
  return parsed.map(adaptBatchPage)
}

export function adaptSingleResult(json: string): DvPage {
  const parsed = JSON.parse(json) as RawBatchParsedPage
  return adaptBatchPage(parsed)
}
```

Where `adaptBatchPage` converts:
- Raw batch list items → `DvList` with `precomputedTokens` set and `parent: null` → `parent: undefined`
- Children recursively adapted (they also have `precomputedTokens`)
- `precomputedParentTokens` from a JSON object → `Map<string, ParsedTextToken[]>`
- All other fields passed through directly

Create a helper `adaptBatchListItem(raw: RawBatchDvListItem): DvList` similar to the existing `adaptListItem` but preserving the `precomputedTokens` field.

**Verification:** `bunx tsc --noEmit` in `packages/parser-native/` passes.

---

## Task 6 — Implement `NativeParserProvider` class and `chunkedBatch` utility

**Modify `packages/parser-native/ts/loader.ts`:**

Extend `WasmExports` type:

```typescript
export type WasmExports = {
  ping: () => string
  parse_frontmatter: (content: string) => string
  scan_markdown: (content: string, file_path: string, frontmatter_body_start: number, archive_tag: string) => string
  parse_tokens: (text: string) => string
  batch_parse_chunk: (json_input: string) => string
  parse_single_file: (content: string, path: string, mtime: number, archive_tag: string) => string
}
```

Update `loadWasm` to extract and return the two new functions from the glue module.

**Modify `packages/parser-native/ts/index.ts`:**

Update `NativeParserHandle` type to include new functions. Add and export:

```typescript
import type { ParserProvider, FileInput } from "@mdtree/core"
import type { DvPage, ParsedTextToken } from "@mdtree/core"
import { adaptBatchResult, adaptSingleResult, adaptParseTokens } from "./adapter.ts"

export class NativeParserProvider implements ParserProvider {
  constructor(private handle: NativeParserHandle) {}

  parseBatchChunk(files: FileInput[]): DvPage[] {
    const input = JSON.stringify(files)
    const json = this.handle.batch_parse_chunk(input)
    return adaptBatchResult(json)
  }

  parseTokens(text: string): ParsedTextToken[] {
    const json = this.handle.parse_tokens(text)
    return adaptParseTokens(json)
  }

  parseVaultFile(content: string, filePath: string, mtime: number, archiveTag: string): DvPage {
    const json = this.handle.parse_single_file(content, filePath, mtime, archiveTag)
    return adaptSingleResult(json)
  }
}

export function createNativeParserProvider(handle: NativeParserHandle): ParserProvider {
  return new NativeParserProvider(handle)
}

export async function chunkedBatch(
  provider: ParserProvider,
  files: FileInput[],
  chunkSize = 50,
): Promise<DvPage[]> {
  const results: DvPage[] = []
  for (let i = 0; i < files.length; i += chunkSize) {
    const chunk = files.slice(i, i + chunkSize)
    results.push(...provider.parseBatchChunk(chunk))
    if (i + chunkSize < files.length) {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
  }
  return results
}
```

Export all new symbols (`NativeParserProvider`, `createNativeParserProvider`, `chunkedBatch`).

**Verification:** `bunx tsc --noEmit` in `packages/parser-native/` passes.

---

## Task 7 — Write TypeScript conformance tests for batch API

**Create `packages/parser-native/ts/__tests__/batch-api.test.ts`:**

This test file requires WASM to be built (`wasm-pack build --target web --out-dir pkg` must have been run).

Tests to implement:

1. **Basic batch conformance:** Load all `.md` fixture files from `packages/core/src/__tests__/integration/fixtures/**/*.md`. Call `NativeParserProvider.parseBatchChunk(fixtures)` and `TsParserProvider.parseBatchChunk(fixtures)`. For each corresponding `DvPage`, strip `precomputedTokens` from all `DvList` items (recursively) and strip `precomputedParentTokens` from the page, then assert deep equality with the TS output.

2. **Pre-computed tokens match parseTokens:** For each `DvList` item in the native batch output, assert `item.precomputedTokens` deeply equals `TsParserProvider.parseTokens(item.rawText)`. Check recursively through `children`.

3. **Pre-computed parent tokens match:** For fixture `multi-page/index.md` (has `parent: "[[Root]]"`), assert `page.precomputedParentTokens.get("[[Root]]")` deeply equals `TsParserProvider.parseTokens("[[Root]]")`.

4. **Single file matches batch:** Call `NativeParserProvider.parseVaultFile(content, path, mtime, archiveTag)` for one fixture file. Call `NativeParserProvider.parseBatchChunk([sameFileAsInput])`. Assert the two results are deeply equal.

5. **Standalone parseTokens conformance:** Call `NativeParserProvider.parseTokens("[[Link]]")` and assert it equals `TsParserProvider.parseTokens("[[Link]]")`. Also test with a more complex string: `"text [[Page#Header|Alias]] more http://example.com"`.

6. **Empty batch:** Assert `NativeParserProvider.parseBatchChunk([])` returns `[]`.

7. **All DvList items have precomputedTokens defined:** For all native batch output, assert no `DvList` item (including nested children) has `precomputedTokens` as `undefined`.

8. **chunkedBatch utility:** Create a mock provider (or use `TsParserProvider`), call `chunkedBatch(provider, files, 2)` with 5 files, assert 5 results returned.

**Verification:** `bun test packages/parser-native/ts/__tests__/batch-api.test.ts` passes.
