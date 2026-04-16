import { describe, it, expect, afterEach } from "bun:test"
import { writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { loadObsidianIgnore, isIgnoredByObsidian } from "../vault/obsidianignore.ts"

// ── Helpers ────────────────────────────────────────────────────────────────────

const TMP = "/tmp/mdtree-ignore-test"

function setup(ignoreContent: string): string {
  mkdirSync(TMP, { recursive: true })
  writeFileSync(join(TMP, ".obsidianignore"), ignoreContent)
  return TMP
}

function clean() {
  try { rmSync(TMP, { recursive: true, force: true }) } catch {}
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("loadObsidianIgnore", () => {
  afterEach(clean)

  it("returns an ignore instance that ignores nothing when no file exists", () => {
    clean() // ensure no file
    mkdirSync(TMP, { recursive: true })
    const ig = loadObsidianIgnore(TMP)
    expect(isIgnoredByObsidian(ig, TMP, join(TMP, "note.md"))).toBe(false)
  })

  it("parses a simple extension pattern", () => {
    setup("*.pdf\n")
    const ig = loadObsidianIgnore(TMP)
    expect(isIgnoredByObsidian(ig, TMP, join(TMP, "doc.pdf"))).toBe(true)
    expect(isIgnoredByObsidian(ig, TMP, join(TMP, "note.md"))).toBe(false)
  })

  it("parses a directory pattern", () => {
    setup("Archive/**\n")
    const ig = loadObsidianIgnore(TMP)
    expect(isIgnoredByObsidian(ig, TMP, join(TMP, "Archive/old.md"))).toBe(true)
    expect(isIgnoredByObsidian(ig, TMP, join(TMP, "Active/note.md"))).toBe(false)
  })

  it("ignores comment lines starting with #", () => {
    setup("# this is a comment\n*.tmp\n")
    const ig = loadObsidianIgnore(TMP)
    expect(isIgnoredByObsidian(ig, TMP, join(TMP, "file.tmp"))).toBe(true)
    expect(isIgnoredByObsidian(ig, TMP, join(TMP, "note.md"))).toBe(false)
  })

  it("ignores blank lines", () => {
    setup("\n\n*.log\n\n")
    const ig = loadObsidianIgnore(TMP)
    expect(isIgnoredByObsidian(ig, TMP, join(TMP, "debug.log"))).toBe(true)
  })

  it("supports multiple patterns", () => {
    setup("*.pdf\n*.epub\nPrivate/**\n")
    const ig = loadObsidianIgnore(TMP)
    expect(isIgnoredByObsidian(ig, TMP, join(TMP, "book.epub"))).toBe(true)
    expect(isIgnoredByObsidian(ig, TMP, join(TMP, "Private/secret.md"))).toBe(true)
    expect(isIgnoredByObsidian(ig, TMP, join(TMP, "note.md"))).toBe(false)
  })

  it("does not ignore paths outside the vault root", () => {
    setup("*.md\n")
    const ig = loadObsidianIgnore(TMP)
    // Path outside vault root: returns false (safe default)
    expect(isIgnoredByObsidian(ig, TMP, "/other/path/note.md")).toBe(false)
  })
})
