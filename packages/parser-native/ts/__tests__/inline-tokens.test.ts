import { describe, it, expect, beforeAll } from "bun:test"
import { resolve } from "path"
import { readdirSync, statSync } from "fs"
import { parseTokens, parseVaultFile } from "@mdtree/core"
import { adaptParseTokens } from "../adapter.ts"
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

function parseWithRust(text: string) {
  const json = handle.parse_tokens(text)
  return adaptParseTokens(json)
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

describe("Inline Tokens Conformance: Rust vs TypeScript", () => {
  describe("Fixture-derived rawText values", () => {
    const mdFiles = findMdFiles(FIXTURES_PATH)

    for (const filePath of mdFiles) {
      const relativePath = filePath.replace(FIXTURES_PATH + "/", "")

      it(`${relativePath} — rawText values`, async () => {
        const content = await Bun.file(filePath).text()
        const page = parseVaultFile(content, relativePath, Date.now(), "archive")

        // Collect all rawText values from list items
        const rawTexts = new Set<string>()
        for (const item of page.file.lists.values) {
          if (item.rawText) rawTexts.add(item.rawText)
        }

        // Also test frontmatter parent strings
        const fm = page.file.frontmatter
        if (fm && typeof fm === "object") {
          const parentVal = (fm as Record<string, unknown>)["parent"]
          if (typeof parentVal === "string") {
            rawTexts.add(parentVal)
          }
          const parentArr = (fm as Record<string, unknown>)["parents"]
          if (Array.isArray(parentArr)) {
            for (const p of parentArr) {
              if (typeof p === "string") rawTexts.add(p)
            }
          }
        }

        for (const rawText of rawTexts) {
          const tsResult = parseTokens(rawText)
          const rustResult = parseWithRust(rawText)
          expect(rustResult).toEqual(tsResult)
        }
      })
    }
  })

  describe("Synthetic conformance tests", () => {
    it("plain obsidian link", () => {
      const input = "[[Note]]"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("obsidian link with alias", () => {
      const input = "[[Note|Display Name]]"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("obsidian link with header", () => {
      const input = "[[Note#Section]]"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("obsidian link with header and alias", () => {
      const input = "[[Note#Section|Alias]]"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("obsidian link with folder path", () => {
      const input = "[[folder/Note]]"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("markdown link", () => {
      const input = "[text](https://example.com)"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("image", () => {
      const input = "![screenshot](img.png)"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("bare HTTP URL", () => {
      const input = "see https://example.com/path for details"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("bold text (two-token)", () => {
      const input = "**important** note"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("italic text (two-token)", () => {
      const input = "*emphasized* word"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("strikethrough (two-token)", () => {
      const input = "~~removed~~ text"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("inline code (single-token)", () => {
      const input = "`variable` name"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("meta-action triple with icon", () => {
      const input = "task (meta-action-name::Open)(meta-action-url::https://x.com)(meta-action-icon::globe-01-16)"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("meta-action without icon", () => {
      const input = "link (meta-action-name::Open)(meta-action-url::https://x.com)"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("meta-mdtree", () => {
      const input = "item (meta-mdtree:: archive)"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("mixed content", () => {
      const input = "[[Page]] is great *and* has https://link.com"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("empty string", () => {
      const input = ""
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("text only (no special tokens)", () => {
      const input = "just plain text"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("URL from todoist fixture", () => {
      const input = "Buy milk https://app.todoist.com/app/task/task1 (meta-action-name::Open Task)(meta-action-url::https://app.todoist.com/app/task/task1)(meta-action-icon::globe-01-16)"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    // ── Regression tests for code review findings ──────────────────────────

    it("empty meta-action icon becomes absent (not empty string)", () => {
      const input = "text (meta-action-name::X)(meta-action-url::Y)(meta-action-icon::)"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("double-backtick code span", () => {
      const input = "``code content``"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("double-backtick with single backtick inside", () => {
      const input = "``foo ` bar``"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("URL inside underscore emphasis not detected as link", () => {
      const input = "_https://example.com_"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("URL inside emphasis with preceding space IS detected", () => {
      // When URL has a space before it and does NOT consume the closing *, emphasis forms
      const input = "*see https://example.com for info*"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("standalone bold (padding tokens)", () => {
      const input = "**bold**"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })

    it("standalone italic", () => {
      const input = "*italic*"
      expect(parseWithRust(input)).toEqual(parseTokens(input))
    })
  })
})
