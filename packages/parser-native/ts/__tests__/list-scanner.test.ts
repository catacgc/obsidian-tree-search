import { describe, it, expect, beforeAll } from "bun:test"
import { resolve } from "path"
import { readdirSync, statSync } from "fs"
import { scanMarkdown, parseFrontmatter } from "@mdtree/core"
import { adaptScanResult } from "../adapter.ts"
import type { NativeParserHandle } from "../index.ts"
import { loadNativeParser } from "../index.ts"

// This test requires `wasm-pack build --target web --out-dir pkg` to have been run first.
const WASM_PATH = resolve(import.meta.dir, "../../pkg/parser_native_bg.wasm")
const FIXTURES_PATH = resolve(import.meta.dir, "../../../core/src/__tests__/integration/fixtures")

let handle: NativeParserHandle

beforeAll(async () => {
  const wasmBytes = await Bun.file(WASM_PATH).arrayBuffer()
  handle = await loadNativeParser(wasmBytes)
})

function scanWithRust(content: string, filePath: string, bodyStart: number, archiveTag: string) {
  const json = handle.scan_markdown(content, filePath, bodyStart, archiveTag)
  return adaptScanResult(json)
}

/**
 * Recursively find all .md files under a directory.
 */
function findMdFiles(dir: string): string[] {
  const results: string[] = []
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const full = resolve(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      results.push(...findMdFiles(full))
    } else if (entry.endsWith(".md")) {
      results.push(full)
    }
  }
  return results
}

describe("List Scanner Conformance: Rust vs TypeScript", () => {
  describe("Fixture files", () => {
    const mdFiles = findMdFiles(FIXTURES_PATH)

    for (const filePath of mdFiles) {
      const relativePath = filePath.replace(FIXTURES_PATH + "/", "")

      it(`${relativePath}`, async () => {
        const content = await Bun.file(filePath).text()
        const { bodyStart } = parseFrontmatter(content)

        const tsResult = scanMarkdown(content, relativePath, bodyStart, "archive")
        const rustResult = scanWithRust(content, relativePath, bodyStart, "archive")

        expect(rustResult.headers).toEqual(tsResult.headers)
        expect(rustResult.lists).toEqual(tsResult.lists)
      })
    }
  })

  describe("Synthetic inputs", () => {
    it("meta-action stripping", () => {
      const content = "- https://example.com (meta-action-name::Open)(meta-action-url::https://x.com)(meta-action-icon::globe-01-16)"
      const tsResult = scanMarkdown(content, "test.md", 0, "archive")
      const rustResult = scanWithRust(content, "test.md", 0, "archive")
      expect(rustResult.lists).toEqual(tsResult.lists)
    })

    it("nested items with parent wiring", () => {
      const content = "- [[Parent]]\n  - [[Child A]]\n  - [[Child B]]\n    - [[Grandchild]]"
      const tsResult = scanMarkdown(content, "test.md", 0, "archive")
      const rustResult = scanWithRust(content, "test.md", 0, "archive")
      expect(rustResult.lists).toEqual(tsResult.lists)
    })

    it("task detection - uncompleted", () => {
      const content = "- [ ] review [[Note]]"
      const tsResult = scanMarkdown(content, "test.md", 0, "archive")
      const rustResult = scanWithRust(content, "test.md", 0, "archive")
      expect(rustResult.lists).toEqual(tsResult.lists)
    })

    it("task detection - completed lowercase", () => {
      const content = "- [x] [[Done]] task"
      const tsResult = scanMarkdown(content, "test.md", 0, "archive")
      const rustResult = scanWithRust(content, "test.md", 0, "archive")
      expect(rustResult.lists).toEqual(tsResult.lists)
    })

    it("task detection - completed uppercase", () => {
      const content = "- [X] [[Also Done]]"
      const tsResult = scanMarkdown(content, "test.md", 0, "archive")
      const rustResult = scanWithRust(content, "test.md", 0, "archive")
      expect(rustResult.lists).toEqual(tsResult.lists)
    })

    it("CRLF content", () => {
      const content = "# Header\r\n\r\n- [[Note]] text\r\n  - [[Child]] sub\r\n\r\n## Sub\r\n\r\n- [[Other]]"
      const tsResult = scanMarkdown(content, "test.md", 0, "archive")
      const rustResult = scanWithRust(content, "test.md", 0, "archive")
      expect(rustResult.headers).toEqual(tsResult.headers)
      expect(rustResult.lists).toEqual(tsResult.lists)
    })

    it("multiple headers with items between them", () => {
      const content = "# First\n\n- [[A]] item\n- [[B]] item\n\n# Second\n\n- [[C]] item\n\n## Third\n\n- [[D]] item"
      const tsResult = scanMarkdown(content, "test.md", 0, "archive")
      const rustResult = scanWithRust(content, "test.md", 0, "archive")
      expect(rustResult.headers).toEqual(tsResult.headers)
      expect(rustResult.lists).toEqual(tsResult.lists)
    })

    it("file with frontmatter (non-zero bodyStart)", () => {
      const content = "---\nparent: \"[[Root]]\"\n---\n\n# Index\n\n- [[Child Note]] see details"
      const { bodyStart } = parseFrontmatter(content)
      const tsResult = scanMarkdown(content, "multi-page/index.md", bodyStart, "archive")
      const rustResult = scanWithRust(content, "multi-page/index.md", bodyStart, "archive")
      expect(rustResult.headers).toEqual(tsResult.headers)
      expect(rustResult.lists).toEqual(tsResult.lists)
    })

    it("items with meta-mdtree", () => {
      const content = "- [[Beta]] done (meta-mdtree:: archive)\n- [[Gamma]] still relevant"
      const tsResult = scanMarkdown(content, "test.md", 0, "archive")
      const rustResult = scanWithRust(content, "test.md", 0, "archive")
      expect(rustResult.lists).toEqual(tsResult.lists)
    })

    it("archive tag filtering", () => {
      const content = "- [[Note]] #archive\n- [[Other]] #todo"
      const tsResult = scanMarkdown(content, "test.md", 0, "archive")
      const rustResult = scanWithRust(content, "test.md", 0, "archive")
      expect(rustResult.lists).toEqual(tsResult.lists)
    })

    it("pure prose items skipped", () => {
      const content = "- just some text\n- more prose\n- [[real link]]"
      const tsResult = scanMarkdown(content, "test.md", 0, "archive")
      const rustResult = scanWithRust(content, "test.md", 0, "archive")
      expect(rustResult.lists).toEqual(tsResult.lists)
    })

    it("star and plus bullets", () => {
      const content = "* [[A]] item\n+ [[B]] item\n1. [[C]] numbered"
      const tsResult = scanMarkdown(content, "test.md", 0, "archive")
      const rustResult = scanWithRust(content, "test.md", 0, "archive")
      expect(rustResult.lists).toEqual(tsResult.lists)
    })

    it("deep nesting with indent stack reset on header", () => {
      const content = "- [[Pre]]\n  - [[Nested]]\n    - [[Deep]]\n# New Section\n- [[Post]]"
      const tsResult = scanMarkdown(content, "test.md", 0, "archive")
      const rustResult = scanWithRust(content, "test.md", 0, "archive")
      expect(rustResult.headers).toEqual(tsResult.headers)
      expect(rustResult.lists).toEqual(tsResult.lists)
    })

    it("items with task-reference pattern kept (- [ check)", () => {
      const content = "- see item - [x] done"
      const tsResult = scanMarkdown(content, "test.md", 0, "archive")
      const rustResult = scanWithRust(content, "test.md", 0, "archive")
      expect(rustResult.lists).toEqual(tsResult.lists)
    })

    it("trailing whitespace on list items", () => {
      const content = "- [[Note]]   \n- [[Other]]  "
      const tsResult = scanMarkdown(content, "test.md", 0, "archive")
      const rustResult = scanWithRust(content, "test.md", 0, "archive")
      expect(rustResult.lists).toEqual(tsResult.lists)
    })

    it("trailing whitespace on headers", () => {
      const content = "# Hello   \n\n- [[Note]]"
      const tsResult = scanMarkdown(content, "test.md", 0, "archive")
      const rustResult = scanWithRust(content, "test.md", 0, "archive")
      expect(rustResult.headers).toEqual(tsResult.headers)
      expect(rustResult.lists).toEqual(tsResult.lists)
    })
  })
})
