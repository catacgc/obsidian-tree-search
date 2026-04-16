import { describe, it, expect, beforeEach } from "bun:test"
import { NotesGraph } from "../graph/graph.ts"
import type { PageNode, TextNode, HeaderNode, FolderNode } from "../graph/types.ts"

// ── Helpers ────────────────────────────────────────────────────────────────────

const loc = (path: string, line = 0) => ({
  path,
  position: { start: { line, ch: 0 }, end: { line, ch: 0 } },
})

function makePage(name: string, path = `${name}.md`, isReference = false): PageNode {
  return {
    nodeType: "page",
    isReference,
    page: name,
    aliases: [],
    tags: [],
    location: loc(path),
    searchKey: name.toLowerCase(),
    boost: 1,
    ageDays: 0,
  }
}

function makeText(text: string, path = "note.md", line = 1): TextNode {
  return {
    nodeType: "text",
    location: loc(path, line),
    searchKey: text.toLowerCase(),
    parsedTokens: [{ tokenType: "text", text, decoration: "none" }],
    tags: [],
    isTask: false,
    isCompleted: false,
    boost: 1,
    ageDays: 0,
  }
}

function makeHeader(page: string, header: string, path = `${page}.md`): HeaderNode {
  return {
    nodeType: "header",
    page,
    header,
    indent: 1,
    location: loc(path),
    searchKey: `${page}#${header}`.toLowerCase(),
    boost: 1,
    ageDays: 0,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("NotesGraph", () => {
  let g: NotesGraph

  beforeEach(() => {
    g = new NotesGraph()
  })

  describe("addOrUpdateNode / hasNode / getNodeAttributes", () => {
    it("adds a page node", () => {
      const page = makePage("Alpha")
      g.addOrUpdateNode(page)
      expect(g.hasNode("[[alpha]]")).toBe(true)
      expect(g.getNodeAttributes("[[alpha]]")).toMatchObject({ page: "Alpha" })
    })

    it("adds a text node", () => {
      const text = makeText("Do the thing")
      g.addOrUpdateNode(text)
      expect(g.hasNode("do the thing")).toBe(true)
    })

    it("adds a header node", () => {
      const header = makeHeader("Alpha", "Section One")
      g.addOrUpdateNode(header)
      expect(g.hasNode("alpha#section one")).toBe(true)
    })

    it("merges aliases on duplicate page nodes", () => {
      const p1 = { ...makePage("Alpha"), aliases: ["A"] }
      const p2 = { ...makePage("Alpha"), aliases: ["B"] }
      g.addOrUpdateNode(p1)
      g.addOrUpdateNode(p2)
      const node = g.getNodeAttributes("[[alpha]]") as PageNode
      expect(node.aliases).toContain("A")
      expect(node.aliases).toContain("B")
    })

    it("preserves isReference=false when merging reference + real page", () => {
      const ref = { ...makePage("Alpha"), isReference: true }
      const real = { ...makePage("Alpha"), isReference: false }
      g.addOrUpdateNode(ref)
      g.addOrUpdateNode(real)
      const node = g.getNodeAttributes("[[alpha]]") as PageNode
      expect(node.isReference).toBe(false)
    })

    it("canvas page key strips .canvas extension", () => {
      const canvas: PageNode = { ...makePage("Board.canvas", "Board.canvas"), page: "Board.canvas" }
      g.addOrUpdateNode(canvas)
      expect(g.hasNode("[[board]]")).toBe(true)
    })
  })

  describe("order / size", () => {
    it("order counts nodes", () => {
      g.addOrUpdateNode(makePage("A"))
      g.addOrUpdateNode(makePage("B"))
      expect(g.order).toBe(2)
    })

    it("size counts edges", () => {
      const a = makePage("A")
      const b = makePage("B")
      g.addOrUpdateNode(a)
      g.addOrUpdateNode(b)
      g.addChild(a, b, loc("A.md"), 0)
      expect(g.size).toBe(1)
    })
  })

  describe("addChild / hasEdge / outboundEdgeEntries", () => {
    it("creates a parent edge between two existing nodes", () => {
      const parent = makePage("Parent")
      const child = makeText("child item", "Parent.md")
      g.addOrUpdateNode(parent)
      g.addOrUpdateNode(child)
      g.addChild(parent, child, loc("Parent.md"), 0)

      expect(g.hasEdge("[[parent]]", "child item")).toBe(true)
      const edges = g.outboundEdgeEntries("[[parent]]")
      expect(edges).toHaveLength(1)
      expect(edges[0].attributes.type).toBe("parent")
    })

    it("does not create edge when nodes are missing", () => {
      const parent = makePage("Ghost")
      const child = makeText("orphan")
      // only add parent, not child
      g.addOrUpdateNode(parent)
      g.addChild(parent, child, loc("Ghost.md"), 0)
      expect(g.size).toBe(0)
    })

    it("deduplicates parallel edges", () => {
      const a = makePage("A")
      const b = makePage("B")
      g.addOrUpdateNode(a)
      g.addOrUpdateNode(b)
      g.addChild(a, b, loc("A.md"), 0)
      g.addChild(a, b, loc("A.md"), 0)
      expect(g.size).toBe(1)
    })

    it("self-loops are ignored", () => {
      const a = makePage("A")
      g.addOrUpdateNode(a)
      g.addChild(a, a, loc("A.md"), 0)
      expect(g.size).toBe(0)
    })
  })

  describe("addRelatedEdge", () => {
    it("creates a related edge", () => {
      const a = makePage("A")
      const b = makePage("B")
      g.addOrUpdateNode(a)
      g.addOrUpdateNode(b)
      g.addRelatedEdge("[[a]]", "[[b]]", loc("canvas.canvas"))
      const edges = g.outboundEdgeEntries("[[a]]")
      expect(edges[0].attributes.type).toBe("related")
    })
  })

  describe("inboundEdgeEntries", () => {
    it("returns incoming edges", () => {
      const a = makePage("A")
      const b = makePage("B")
      g.addOrUpdateNode(a)
      g.addOrUpdateNode(b)
      g.addChild(a, b, loc("A.md"), 0)
      const inbound = g.inboundEdgeEntries("[[b]]")
      expect(inbound).toHaveLength(1)
      expect(inbound[0].source).toBe("[[a]]")
    })
  })

  describe("filterNodes", () => {
    it("returns nodes matching predicate", () => {
      g.addOrUpdateNode(makePage("Alpha", "Alpha.md"))
      g.addOrUpdateNode(makePage("Beta", "Beta.md"))
      g.addOrUpdateNode(makeText("text", "Alpha.md"))
      const keys = g.filterNodes((_, n) => n.location.path === "Alpha.md")
      expect(keys).toContain("[[alpha]]")
      expect(keys).toContain("text")
      expect(keys).not.toContain("[[beta]]")
    })
  })

  describe("removeByPath", () => {
    it("removes edges from the given path", () => {
      const a = makePage("A", "A.md")
      const b = makeText("some text", "A.md", 5)
      g.addOrUpdateNode(a)
      g.addOrUpdateNode(b)
      g.addChild(a, b, loc("A.md"), 0)
      expect(g.size).toBe(1)

      g.removeByPath("A.md")
      expect(g.size).toBe(0)
    })

    it("removes orphaned text nodes after edge removal", () => {
      const a = makePage("A", "A.md")
      const text = makeText("orphanable", "A.md", 3)
      g.addOrUpdateNode(a)
      g.addOrUpdateNode(text)
      g.trackNodePath("orphanable", "A.md")
      g.addChild(a, text, loc("A.md"), 0)

      g.removeByPath("A.md")
      expect(g.hasNode("orphanable")).toBe(false)
    })

    it("keeps real (non-reference) page nodes alive through path removal", () => {
      const a = makePage("A", "A.md", false) // isReference=false
      const b = makePage("B", "B.md")
      g.addOrUpdateNode(a)
      g.addOrUpdateNode(b)
      g.trackNodePath("[[a]]", "A.md")
      g.addChild(a, b, loc("A.md"), 0)

      g.removeByPath("A.md")
      // Real page node survives even without edges
      expect(g.hasNode("[[a]]")).toBe(true)
    })

    it("removes reference (virtual) page nodes when they have no more edges", () => {
      const real = makePage("Real", "Real.md")
      const ref = { ...makePage("Ref", "Real.md"), isReference: true }
      g.addOrUpdateNode(real)
      g.addOrUpdateNode(ref)
      g.trackNodePath("[[ref]]", "Real.md")
      g.addChild(real, ref, loc("Real.md"), 0)

      g.removeByPath("Real.md")
      expect(g.hasNode("[[ref]]")).toBe(false)
    })

    it("is idempotent — double call doesn't throw", () => {
      g.removeByPath("nonexistent.md")
      g.removeByPath("nonexistent.md")
    })
  })

  describe("createFolderNode", () => {
    it("creates and stores a folder node", () => {
      const node = g.createFolderNode("projects", "projects", loc("projects"))
      expect(node.nodeType).toBe("folder")
      expect(g.hasNode("projects")).toBe(true)
    })
  })

  describe("addAttachmentNode", () => {
    it("creates and stores an attachment node", () => {
      const node = g.addAttachmentNode("photo.png", "png", "assets/photo.png", Date.now())
      expect(node.nodeType).toBe("attachment")
      expect(g.hasNode("photo.png")).toBe(true)
    })
  })

  describe("createHeaderNode", () => {
    it("creates a header node with correct key", () => {
      const node = g.createHeaderNode("MyNote", "Introduction", loc("MyNote.md"), 1)
      expect(node.nodeType).toBe("header")
      expect(g.hasNode("mynote#introduction")).toBe(true)
    })
  })
})
