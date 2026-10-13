import { describe, it, expect } from "bun:test"
import { scanMarkdown } from "../parser/list-scanner.ts"

// ── Helpers ────────────────────────────────────────────────────────────────────

function scan(md: string, archive = "archive") {
  // no frontmatter → bodyStart = 0
  return scanMarkdown(md, "test.md", 0, archive)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("scanMarkdown", () => {
  describe("headers", () => {
    it("detects ATX headers and records positions", () => {
      const { headers } = scan("# Alpha\n## Beta\n### Gamma")
      expect(headers).toHaveLength(3)
      expect(headers[0]).toMatchObject({ heading: "Alpha", level: 1 })
      expect(headers[1]).toMatchObject({ heading: "Beta", level: 2 })
      expect(headers[2]).toMatchObject({ heading: "Gamma", level: 3 })
    })

    it("assigns correct line numbers to headers", () => {
      const { headers } = scan("# First\n\n## Second")
      expect(headers[0].position.start.line).toBe(0)
      expect(headers[1].position.start.line).toBe(2)
    })

    it("skips plain text lines as headers", () => {
      const { headers } = scan("not a header\nstill not\n# Real")
      expect(headers).toHaveLength(1)
      expect(headers[0].heading).toBe("Real")
    })
  })

  describe("list items — basic", () => {
    it("skips pure prose (no links, tags, tasks, urls)", () => {
      const { lists } = scan("- just some text\n- more prose")
      expect(lists).toHaveLength(0)
    })

    it("keeps items with obsidian links", () => {
      const { lists } = scan("- [[Note]] is great")
      expect(lists).toHaveLength(1)
      expect(lists[0].text).toBe("[[Note]] is great")
    })

    it("keeps items with bare http links", () => {
      const { lists } = scan("- https://example.com")
      expect(lists).toHaveLength(1)
    })

    it("keeps items with inline tags", () => {
      const { lists } = scan("- buy milk #todo")
      expect(lists).toHaveLength(1)
      expect(lists[0].tags).toContain("#todo")
    })

    it("keeps task items that have links", () => {
      const { lists } = scan("- [ ] review [[Note]]")
      expect(lists).toHaveLength(1)
      expect(lists[0].task).toBe(true)
      expect(lists[0].completed).toBe(false)
    })

    it("keeps plain-text tasks", () => {
      const { lists } = scan("- [ ] plain task text")
      expect(lists).toHaveLength(1)
      expect(lists[0].task).toBe(true)
      expect(scan("- [ ] ").lists).toHaveLength(0)
      expect(scan("- [ ] call #archive").lists).toHaveLength(0)
    })

    it("detects completed tasks", () => {
      const { lists } = scan("- [x] [[Done]]\n- [X] [[Also done]]")
      expect(lists[0].completed).toBe(true)
      expect(lists[1].completed).toBe(true)
    })

    it("strips task prefix from text", () => {
      const { lists } = scan("- [ ] do [[Something]]")
      expect(lists[0].text).toBe("do [[Something]]")
    })

    it("records correct line numbers", () => {
      const { lists } = scan("\n- [[A]]\n\n- [[B]]")
      expect(lists[0].line).toBe(1)
      expect(lists[1].line).toBe(3)
    })

    it("handles * and + bullet prefixes", () => {
      const { lists } = scan("* [[A]]\n+ [[B]]")
      expect(lists).toHaveLength(2)
    })

    it("handles numbered list items", () => {
      const { lists } = scan("1. [[Item]]")
      expect(lists).toHaveLength(1)
    })
  })

  describe("list items — nesting and parent wiring", () => {
    it("assigns parent line for nested items", () => {
      const md = "- [[Parent]]\n  - [[Child]]"
      const { lists } = scan(md)
      expect(lists).toHaveLength(2)
      expect(lists[1].parent).toBe(lists[0].line)
    })

    it("wires .children in post-pass", () => {
      const md = "- [[Parent]]\n  - [[Child A]]\n  - [[Child B]]"
      const { lists } = scan(md)
      const parent = lists[0]
      expect(parent.children).toHaveLength(2)
      expect(parent.children[0].text).toBe("[[Child A]]")
      expect(parent.children[1].text).toBe("[[Child B]]")
    })

    it("deeply nested items get correct parent chain", () => {
      const md = "- [[A]]\n  - [[B]]\n    - [[C]]"
      const { lists } = scan(md)
      expect(lists[1].parent).toBe(lists[0].line)
      expect(lists[2].parent).toBe(lists[1].line)
    })

    it("sibling reset: peer items have no parent", () => {
      const md = "- [[A]]\n- [[B]]"
      const { lists } = scan(md)
      expect(lists[0].parent).toBeUndefined()
      expect(lists[1].parent).toBeUndefined()
    })

    it("indent stack resets properly on de-dent", () => {
      const md = "- [[A]]\n  - [[B]]\n- [[C]]"
      const { lists } = scan(md)
      expect(lists[2].parent).toBeUndefined()
    })

    it("counts a tab as 4 columns, so tab- and space-indented lines nest by their visual depth", () => {
      const md = "- [[A]]\n    - [[B]]\n        - [ ] spaces\n\t\t\t- [ ] tabs\n\t\t- [[C]]\n"
      const { lists } = scan(md)
      expect(lists.map(l => l.parent)).toEqual([undefined, 0, 1, 2, 1])
    })
  })

  describe("section tracking", () => {
    it("assigns section.subpath to items under a header", () => {
      const md = "# Setup\n\n- [[Config]]"
      const { lists } = scan(md)
      expect(lists[0].section.subpath).toBe("#Setup")
    })

    it("updates section on new header", () => {
      const md = "# First\n\n- [[A]]\n\n# Second\n\n- [[B]]"
      const { lists } = scan(md)
      expect(lists[0].section.subpath).toBe("#First")
      expect(lists[1].section.subpath).toBe("#Second")
    })

    it("items before any header have empty subpath", () => {
      const md = "- [[A]]"
      const { lists } = scan(md)
      expect(lists[0].section.subpath).toBe("")
    })

    it("indent stack resets on each new header", () => {
      // After a header the indent stack is cleared, so items under the new
      // header start fresh — not considered children of pre-header items
      const md = "- [[Pre]]\n  - [[Nested]]\n# New\n- [[Post]]"
      const { lists } = scan(md)
      const postHeader = lists.find(l => l.text === "[[Post]]")!
      expect(postHeader.parent).toBeUndefined()
    })
  })

  describe("inline tag extraction", () => {
    it("extracts multiple tags", () => {
      const { lists } = scan("- [[link]] #foo #bar/baz")
      expect(lists[0].tags).toEqual(["#foo", "#bar/baz"])
    })

    it("tags include path separators", () => {
      const { lists } = scan("- [[link]] #project/active")
      expect(lists[0].tags).toContain("#project/active")
    })
  })

  describe("archive tag filtering", () => {
    it("skips items containing the archive tag", () => {
      const { lists } = scan("- [[Note]] #archive", "archive")
      expect(lists).toHaveLength(0)
    })

    it("keeps items with a different tag", () => {
      const { lists } = scan("- [[Note]] #todo", "archive")
      expect(lists).toHaveLength(1)
    })
  })

  describe("frontmatter skip", () => {
    it("skips lines before bodyStart offset", () => {
      // frontmatter occupies first 20 chars: "---\ntitle: hi\n---\n"
      const fm = "---\ntitle: hi\n---\n"
      const body = "- [[Real Item]]"
      const content = fm + body
      const { lists } = scanMarkdown(content, "test.md", fm.length, "archive")
      expect(lists).toHaveLength(1)
      expect(lists[0].text).toBe("[[Real Item]]")
    })
  })

  describe("link field", () => {
    it("sets link.path to the file path argument", () => {
      const { lists } = scanMarkdown("- [[X]]", "vault/notes/foo.md", 0, "archive")
      expect(lists[0].link.path).toBe("vault/notes/foo.md")
    })
  })

  describe("meta-action stripping", () => {
    it("strips meta-action groups from text", () => {
      const { lists } = scan(
        "- https://example.com (meta-action-name::Open)(meta-action-url::https://x.com)(meta-action-icon::globe-01-16)",
      )
      expect(lists).toHaveLength(1)
      expect(lists[0].text).toBe("https://example.com")
    })

    it("strips multiple meta-action triples from text", () => {
      const { lists } = scan(
        "- https://a.com (meta-action-name::A)(meta-action-url::https://a.com)(meta-action-name::B)(meta-action-url::https://b.com)",
      )
      expect(lists[0].text).toBe("https://a.com")
    })

    it("preserves rawText with original meta-action syntax", () => {
      const raw = "- https://example.com (meta-action-name::Open)(meta-action-url::https://x.com)"
      const { lists } = scan(raw)
      expect(lists[0].rawText).toContain("meta-action-name::Open")
    })

    it("rawText equals text when no meta-actions present", () => {
      const { lists } = scan("- https://example.com")
      expect(lists[0].rawText).toBe(lists[0].text)
    })

    it("plain-text task with meta-action triple is not skipped by shouldSkip", () => {
      const { lists } = scan(
        "- Buy milk (meta-action-name::Open Task)(meta-action-url::https://todoist.com/task/1)(meta-action-icon::globe-01-16)",
      )
      // "Buy milk" alone would be skipped by shouldSkip (pure prose), but the meta-action
      // triple means it has value → must be kept
      expect(lists).toHaveLength(1)
      expect(lists[0].text).toBe("Buy milk")
      expect(lists[0].rawText).toContain("meta-action-name::Open Task")
    })

    it("meta-action-only line (no other content) is skipped by shouldSkip", () => {
      // A line that is ONLY meta-action props and no real content → skipped
      const { lists } = scan(
        "- (meta-action-name::X)(meta-action-url::https://x.com)",
      )
      expect(lists).toHaveLength(0)
    })

    it("rawText for a task item is post-task-marker-strip, pre-meta-action-strip", () => {
      const { lists } = scan(
        "- [ ] do [[thing]] (meta-action-name::Open)(meta-action-url::https://x.com)",
      )
      expect(lists).toHaveLength(1)
      expect(lists[0].task).toBe(true)
      // rawText has no "[ ] " prefix but still has meta-action syntax
      expect(lists[0].rawText).toBe("do [[thing]] (meta-action-name::Open)(meta-action-url::https://x.com)")
      // text has meta-actions stripped
      expect(lists[0].text).toBe("do [[thing]]")
    })
  })

  describe("outline break", () => {
    const texts = (md: string) => scan(md).lists.map((l) => l.text)

    it("indexes only the outline before the first prose line after frontmatter", () => {
      const fm = "---\nfrontmatter: value\n---\n"
      const md = fm + "\n- [[an]]\n - [[outline]]\n - [[in this note]]\n\nand then note text\n\n- [[Later]] bullet\n"
      const { lists } = scanMarkdown(md, "test.md", fm.length, "archive")
      expect(lists.map((l) => l.text)).toEqual(["[[an]]", "[[outline]]", "[[in this note]]"])
    })

    it("keeps headings after the break but not their bullets", () => {
      const { lists, headers } = scan("- [[A]]\nprose\n## Later\n- [[B]]")
      expect(lists.map((l) => l.text)).toEqual(["[[A]]"])
      expect(headers.map((h) => h.heading)).toEqual(["Later"])
    })

    it("indexes no bullets when the note starts with prose", () => {
      expect(texts("Thanks, Catalin,\n- [[A]]\n  - [[B]]")).toEqual([])
    })

    it("does not break on comments, headings, blanks, or list continuations", () => {
      const md =
        "<!-- organise:children -->\n- [[A]]\n<!-- /organise:children -->\n\n# H\n- [[B]]\n  continued text\n- [[C]]\n%% note %%\n- [[D]]"
      expect(texts(md)).toEqual(["[[A]]", "[[B]]", "[[C]]", "[[D]]"])
    })

    it("skips everything inside a multi-line comment", () => {
      expect(texts("- [[A]]\n<!--\nprose inside\n- [[Hidden]]\n-->\n- [[B]]")).toEqual(["[[A]]", "[[B]]"])
    })

    for (const b of ["```js", "![[img.png]]", "---", "> [!NOTE]", "| a | b |", "#tag", "https://x.y"]) {
      it(`breaks the outline on ${JSON.stringify(b)}`, () => {
        expect(texts("- [[A]]\n" + b + "\n- [[B]]")).toEqual(["[[A]]"])
      })
    }

    it("breaks on an indented line with no list since the heading", () => {
      expect(texts("# H\n  indented\n- [[A]]")).toEqual([])
    })
  })
})
