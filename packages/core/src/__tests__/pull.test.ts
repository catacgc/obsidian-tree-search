import { describe, it, expect } from "bun:test"
import { NotesGraph } from "../graph/graph.ts"
import { indexSinglePage, DEFAULT_SETTINGS } from "../graph/indexer.ts"
import { parseVaultFile } from "../parser/vault-file.ts"
import {
  buildPullTree,
  formatOccurrenceDate,
  planOrganiseWrites,
  planDeletions,
  type PullNode,
  type OrganiseHome,
} from "../search/pull.ts"
import type { PageNode, TextNode } from "../graph/types.ts"

// ── Helpers ────────────────────────────────────────────────────────────────────

const loc = (path: string, line = 0) => ({
  path,
  position: { start: { line, ch: 0 }, end: { line, ch: 0 } },
})

function makePage(name: string, path = `${name}.md`, ageDays = 0): PageNode {
  return {
    nodeType: "page",
    isReference: false,
    page: name,
    aliases: [],
    tags: [],
    location: loc(path),
    searchKey: name.toLowerCase(),
    boost: 1,
    ageDays,
  }
}

function makeText(text: string, path = "note.md", line = 1, ageDays = 0): TextNode {
  return {
    nodeType: "text",
    location: loc(path, line),
    searchKey: text.toLowerCase(),
    parsedTokens: [{ tokenType: "text", text, decoration: "none" }],
    tags: [],
    isTask: false,
    isCompleted: false,
    boost: 1,
    ageDays,
  }
}

function parse(content: string, path: string) {
  return parseVaultFile(content, path, 1_700_000_000_000)
}

function buildGraph(...pages: ReturnType<typeof parse>[]) {
  const g = new NotesGraph()
  for (const p of pages) indexSinglePage(p, g, DEFAULT_SETTINGS)
  return g
}

const checkAll = () => true

// ── buildPullTree: depth + dedup ────────────────────────────────────────────────

describe("buildPullTree", () => {
  it("returns null for a node not in the graph", () => {
    const g = new NotesGraph()
    expect(buildPullTree(g, "[[nope]]")).toBeNull()
  })

  it("truncates a chain past the depth limit", () => {
    const g = new NotesGraph()
    const pages = Array.from({ length: 8 }, (_, i) => makePage(`p${i}`))
    for (const p of pages) g.addOrUpdateNode(p)
    for (let i = 0; i < pages.length - 1; i++) {
      g.addChild(pages[i], pages[i + 1], loc(`p${i}.md`), 0)
    }

    const tree = buildPullTree(g, "[[p0]]", 5)!
    // depth 1..5 populated (p1..p5), p6 never reached
    let node: PullNode = tree
    const seenKeys: string[] = []
    while (node.children.length > 0) {
      node = node.children[0]
      seenKeys.push(node.key)
    }
    expect(seenKeys).toEqual(["[[p1]]", "[[p2]]", "[[p3]]", "[[p4]]", "[[p5]]"])
  })

  it("includes a diamond-reachable node once, at its first-encountered position", () => {
    const g = new NotesGraph()
    const root = makePage("root")
    const left = makePage("left")
    const right = makePage("right")
    const shared = makePage("shared")
    for (const p of [root, left, right, shared]) g.addOrUpdateNode(p)
    g.addChild(root, left, loc("root.md"), 0)
    g.addChild(root, right, loc("root.md"), 0)
    g.addChild(left, shared, loc("left.md"), 0)
    g.addChild(right, shared, loc("right.md"), 0)

    const tree = buildPullTree(g, "[[root]]")!
    const leftBranch = tree.children.find(c => c.key === "[[left]]")!
    const rightBranch = tree.children.find(c => c.key === "[[right]]")!
    expect(leftBranch.children.map(c => c.key)).toEqual(["[[shared]]"])
    expect(rightBranch.children).toEqual([])
  })

  it("does not follow folder edges", () => {
    const g = new NotesGraph()
    const folder = { nodeType: "folder" as const, path: "f", name: "f", folderNote: "f/f.md", location: loc("f"), searchKey: "f", boost: 1, ageDays: 0 }
    const page = makePage("child")
    g.addOrUpdateNode(folder)
    g.addOrUpdateNode(page)
    g.addFolderEdge("f", "[[child]]", loc("f"))

    const tree = buildPullTree(g, "f")!
    expect(tree.children).toEqual([])
  })

  it("excludes a real page's own headers/body but still surfaces a [[Page]] nested under one of its headings", () => {
    const parentPage = parse("# Related\n- [[Child]]\n- random note http://example.com", "Parent.md")
    const g = buildGraph(parentPage)

    const tree = buildPullTree(g, "[[parent]]")!
    // Neither the "Related" header nor Parent's own "random note" bullet is
    // a candidate - only [[Child]], reached transparently through the header.
    expect(tree.children.map(c => c.key)).toEqual(["[[child]]"])
  })

  it("still aggregates a mention of the root captured in another file, once nested under the root's own heading", () => {
    const parentPage = parse("# Related\n- [[Child]]", "Parent.md")
    const dailyNote = parse("- [[Parent]] had a great idea today", "2025-03-20.md")
    const g = buildGraph(parentPage, dailyNote)

    const tree = buildPullTree(g, "[[parent]]")!
    const keys = tree.children.map(c => c.key)
    expect(keys).toContain("[[child]]")
    expect(tree.children.find(c => c.node.nodeType === "text")).toBeDefined()
  })

  it("re-applies the own-body exclusion when recursing into a nested page that is itself a real note", () => {
    const childPage = parse("# Notes\n- own thought about child http://x.com\n- [[Grandchild]]", "Child.md")
    const parentPage = parse("- [[Child]]", "Parent.md")
    // Index Child.md first so its node keeps its own canonical location
    // rather than being merged in later (as a virtual reference) with
    // Parent.md's [[Child]] mention winning the merge.
    const g = buildGraph(childPage, parentPage)

    const tree = buildPullTree(g, "[[parent]]")!
    const child = tree.children.find(c => c.key === "[[child]]")!
    // Child.md's own header/body is excluded the same way Parent's was;
    // only the nested [[Grandchild]] topic survives.
    expect(child.children.map(c => c.key)).toEqual(["[[grandchild]]"])
  })
})

// ── formatOccurrenceDate ─────────────────────────────────────────────────────────

describe("formatOccurrenceDate", () => {
  it("returns null for non-text nodes", () => {
    expect(formatOccurrenceDate(makePage("child"))).toBeNull()
  })

  it("returns null for undated text nodes", () => {
    const g = new NotesGraph()
    const t = makeText("hello")
    // ageDays defaults to 0 in the helper; use UNDATED_AGE explicitly
    expect(formatOccurrenceDate({ ...t, ageDays: Number.MAX_SAFE_INTEGER })).toBeNull()
    void g
  })

  it("reconstructs the calendar date from ageDays exactly", () => {
    const dayMs = 24 * 60 * 60 * 1000
    const target = new Date("2025-03-22")
    const ageDays = Math.floor((Date.now() - target.getTime()) / dayMs)
    const t = makeText("http://test-url", "note.md", 1, ageDays)
    expect(formatOccurrenceDate(t)).toBe("2025-03-22")
  })
})

// ── End-to-end: the daily-note rollup example ───────────────────────────────────

describe("Pull children - end-to-end example", () => {
  // Daily note 1: bare-wikilink nesting wires a structural [[Parent]] -> [[Child]] edge.
  const dailyNote1 = parse("- [[Parent]]\n  - [[Child]]", "2025-03-20.md")
  // Daily note 2: two scattered mentions of [[Child]], each becoming its own text node.
  const dailyNote2 = parse("- [[Child]] http://test-url\n- [[Child]] test note without url", "2025-03-22.md")

  function freshGraph() {
    return buildGraph(dailyNote1, dailyNote2)
  }

  it("builds the expected subtree shape from [[Parent]]", () => {
    const g = freshGraph()
    const tree = buildPullTree(g, "[[parent]]")!
    expect(tree.children).toHaveLength(1)
    const child = tree.children[0]
    expect(child.key).toBe("[[child]]")
    expect(child.children.map(c => c.node.nodeType)).toEqual(["text", "text"])
  })

  it("routes the root's direct page-children into the root's own home, as a bare link with no attached date", () => {
    const g = freshGraph()
    const tree = buildPullTree(g, "[[parent]]")!
    const rootHome: OrganiseHome = { path: "Organising.md", exists: true }
    const resolveHome = (key: string): OrganiseHome => ({ path: `home-for-${key}`, exists: false })

    const writes = planOrganiseWrites(tree, rootHome, checkAll, resolveHome)

    const rootWrite = writes.find(w => w.home.path === "Organising.md")!
    expect(rootWrite.children).toEqual([{ depth: 0, text: "[[Child]]" }])
    expect(rootWrite.mentions).toEqual([])
  })

  it("deletes fully-consumed source lines when everything is checked", () => {
    const g = freshGraph()
    const tree = buildPullTree(g, "[[parent]]")!
    const deletions = planDeletions(g, tree, checkAll)

    const paths = deletions.map(d => d.location.path).sort()
    expect(paths).toEqual(["2025-03-20.md", "2025-03-22.md", "2025-03-22.md"])
    // [[Parent]]'s own line is never a deletion candidate - only descendants are.
    expect(deletions.some(d => d.key === "[[parent]]")).toBe(false)
  })

  it("does not delete a line whose child was left unchecked", () => {
    const g = freshGraph()
    const tree = buildPullTree(g, "[[parent]]")!
    const childKey = tree.children[0].key // "[[child]]"
    const urlLineKey = tree.children[0].children[0].key

    // Leave the URL mention line unchecked.
    const isChecked = (key: string) => key !== urlLineKey
    const deletions = planDeletions(g, tree, isChecked)

    // [[Child]]'s daily-note-1 anchor line now has an un-pulled child -> not deletable.
    expect(deletions.some(d => d.key === childKey)).toBe(false)
    // The unchecked line itself was never a delete candidate either.
    expect(deletions.some(d => d.key === urlLineKey)).toBe(false)
    // The other (checked, childless) mention line is still safe to delete.
    expect(deletions).toHaveLength(1)
  })

  it("routes a page-child's own text-mentions into that child's resolved home, not the root's", () => {
    const g = freshGraph()
    const tree = buildPullTree(g, "[[parent]]")!
    const rootHome: OrganiseHome = { path: "Organising.md", exists: true }
    const resolveHome = (key: string): OrganiseHome =>
      key === "[[child]]" ? { path: "Child.md", exists: false } : { path: "Organising.md", exists: true }

    const writes = planOrganiseWrites(tree, rootHome, checkAll, resolveHome)

    const childWrite = writes.find(w => w.home.path === "Child.md")!
    expect(childWrite.children).toEqual([])
    expect(childWrite.mentions.map(l => l.text)).toEqual([
      "[[Child]] [http://test-url](http://test-url) 2025-03-22",
      "[[Child]] test note without url 2025-03-22",
    ])

    const rootWrite = writes.find(w => w.home.path === "Organising.md")!
    expect(rootWrite.mentions).toEqual([])
  })

  it("never resolves a home for a checked page-child that ends up with no checked descendants of its own", () => {
    const g = freshGraph()
    const tree = buildPullTree(g, "[[parent]]")!
    const childKey = tree.children[0].key // "[[child]]"
    const resolveHomeCalls: string[] = []
    const resolveHome = (key: string): OrganiseHome => {
      resolveHomeCalls.push(key)
      return { path: key, exists: false }
    }
    // Only [[Child]] itself is checked - none of its own mention children are.
    const isChecked = (key: string) => key === childKey

    const writes = planOrganiseWrites(tree, { path: "Organising.md", exists: true }, isChecked, resolveHome)

    expect(resolveHomeCalls).toEqual([])
    expect(writes).toHaveLength(1)
    expect(writes[0].home.path).toBe("Organising.md")
    expect(writes[0].children).toEqual([{ depth: 0, text: "[[Child]]" }])
  })

  it("omits a home from the result entirely when nothing is checked", () => {
    const g = freshGraph()
    const tree = buildPullTree(g, "[[parent]]")!
    const writes = planOrganiseWrites(
      tree,
      { path: "Organising.md", exists: true },
      () => false,
      () => ({ path: "unused", exists: false }),
    )
    expect(writes).toEqual([])
  })

  it("keeps distinct homes separate and merges siblings resolving to the same home", () => {
    // Build a graph with root and two page-children A and B, each with text mentions
    // from separate daily notes. This ensures resolveHome is called for them.
    const parentPage = parse("- [[A]]\n- [[B]]", "Organiser.md")
    const dailyNoteA = parse("- [[A]] note from A", "2025-01-01.md")
    const dailyNoteB = parse("- [[B]] note from B", "2025-01-02.md")
    const g = buildGraph(parentPage, dailyNoteA, dailyNoteB)

    const tree = buildPullTree(g, "[[organiser]]")!
    const rootHome: OrganiseHome = { path: "Organising.md", exists: true }

    // First: distinct homes stay separate.
    const resolveHomeDistinct = (key: string): OrganiseHome =>
      key === "[[a]]" ? { path: "A.md", exists: false } : { path: "B.md", exists: false }

    const writesDistinct = planOrganiseWrites(tree, rootHome, checkAll, resolveHomeDistinct)

    expect(writesDistinct).toHaveLength(3) // Organising.md, A.md, B.md
    const orgWrite = writesDistinct.find(w => w.home.path === "Organising.md")!
    const aWrite = writesDistinct.find(w => w.home.path === "A.md")!
    const bWrite = writesDistinct.find(w => w.home.path === "B.md")!

    expect(orgWrite.children.map(l => l.text)).toEqual(["[[A]]", "[[B]]"])
    expect(aWrite.mentions.length).toBe(1) // Has the mention from dailyNoteA
    expect(bWrite.mentions.length).toBe(1) // Has the mention from dailyNoteB

    // Second: siblings resolving to the same home get merged into one SectionWrite.
    const resolveHomeSame = (): OrganiseHome => ({ path: "Common.md", exists: false })

    const writesSame = planOrganiseWrites(tree, rootHome, checkAll, resolveHomeSame)

    expect(writesSame).toHaveLength(2) // Organising.md, Common.md
    const orgWriteSame = writesSame.find(w => w.home.path === "Organising.md")!
    const commonWrite = writesSame.find(w => w.home.path === "Common.md")!

    // A and B themselves are added to root's .children (they're page-children of root)
    expect(orgWriteSame.children.map(l => l.text)).toEqual(["[[A]]", "[[B]]"])
    // Their descendants merge into Common.md
    expect(commonWrite.mentions.length).toBe(2) // Both mentions end up here
  })

  it("resolves homes correctly at depth > 1, chaining through lazy homeThunk", () => {
    // Build: Parent -> Child -> Grandchild (all pages via nested wikilinks),
    // with a text mention under Grandchild to ensure all homes get created.
    const parentPage = parse("- [[Child]]", "Parent.md")
    const childPage = parse("- [[Grandchild]]", "Child.md")
    const grandchildPage = parse("- [[Grandchild]] important note", "Grandchild.md")
    const g = buildGraph(parentPage, childPage, grandchildPage)

    const tree = buildPullTree(g, "[[parent]]")!
    const rootHome: OrganiseHome = { path: "Organising.md", exists: true }

    const resolveHome = (key: string): OrganiseHome => {
      if (key === "[[child]]") return { path: "Child.md", exists: false }
      if (key === "[[grandchild]]") return { path: "Grandchild.md", exists: false }
      return rootHome
    }

    const writes = planOrganiseWrites(tree, rootHome, checkAll, resolveHome)

    // Three homes: root, Child.md, Grandchild.md.
    expect(writes).toHaveLength(3)

    // Root (Organising.md) contains [[Child]].
    const rootWrite = writes.find(w => w.home.path === "Organising.md")!
    expect(rootWrite.children.map(l => l.text)).toEqual(["[[Child]]"])
    expect(rootWrite.mentions).toEqual([])

    // Child.md contains [[Grandchild]], NOT nested under [[Child]] or under root.
    const childWrite = writes.find(w => w.home.path === "Child.md")!
    expect(childWrite.children.map(l => l.text)).toEqual(["[[Grandchild]]"])
    expect(childWrite.mentions).toEqual([])

    // Grandchild.md has the mention from Grandchild.md file, not nested elsewhere.
    const grandchildWrite = writes.find(w => w.home.path === "Grandchild.md")!
    expect(grandchildWrite.children).toEqual([])
    expect(grandchildWrite.mentions.length).toBe(1) // Has the "important note" mention
  })
})
