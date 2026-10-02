import { describe, it, expect } from "bun:test"
import { NotesGraph } from "../graph/graph.ts"
import { indexSinglePage, DEFAULT_SETTINGS } from "../graph/indexer.ts"
import { reindexFileInGraph } from "../graph/builder.ts"
import type { VaultScanner } from "../graph/scanner.ts"
import { parseVaultFile } from "../parser/vault-file.ts"
import {
  buildPullTree,
  formatOccurrenceDate,
  planOrganiseWrites,
  planDeletions,
  renderPullLine,
  type PullNode,
  type OrganiseHome,
  type PullDeletion,
  type SectionWrite,
} from "../search/pull.ts"
import { upsertOrganiseSections } from "../search/organise-sections.ts"
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

    const writes = planOrganiseWrites(g, tree, rootHome, checkAll, resolveHome)

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

  it("leaves an unchecked line in place without blocking lines it isn't nested under", () => {
    const g = freshGraph()
    const tree = buildPullTree(g, "[[parent]]")!
    const childKey = tree.children[0].key // "[[child]]"
    const urlLineKey = tree.children[0].children[0].key

    // Leave the URL mention line (in 2025-03-22.md) unchecked.
    const isChecked = (key: string) => key !== urlLineKey
    const deletions = planDeletions(g, tree, isChecked)

    // The unchecked line itself is never deleted.
    expect(deletions.some(d => d.key === urlLineKey)).toBe(false)
    // [[Child]]'s bullet in 2025-03-20.md has nothing nested under it there,
    // and the other checked mention is childless: both are removed.
    expect(deletions.map(d => d.key).sort()).toEqual([childKey, tree.children[0].children[1].key].sort())
  })

  it("routes a page-child's own text-mentions into that child's resolved home, not the root's", () => {
    const g = freshGraph()
    const tree = buildPullTree(g, "[[parent]]")!
    const rootHome: OrganiseHome = { path: "Organising.md", exists: true }
    const resolveHome = (key: string): OrganiseHome =>
      key === "[[child]]" ? { path: "Child.md", exists: false } : { path: "Organising.md", exists: true }

    const writes = planOrganiseWrites(g, tree, rootHome, checkAll, resolveHome)

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

    const writes = planOrganiseWrites(g, tree, { path: "Organising.md", exists: true }, isChecked, resolveHome)

    expect(resolveHomeCalls).toEqual([])
    expect(writes).toHaveLength(1)
    expect(writes[0].home.path).toBe("Organising.md")
    expect(writes[0].children).toEqual([{ depth: 0, text: "[[Child]]" }])
  })

  it("omits a home from the result entirely when nothing is checked", () => {
    const g = freshGraph()
    const tree = buildPullTree(g, "[[parent]]")!
    const writes = planOrganiseWrites(g, tree, { path: "Organising.md", exists: true },
    () => false,
    () => ({ path: "unused", exists: false }),)
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

    const writesDistinct = planOrganiseWrites(g, tree, rootHome, checkAll, resolveHomeDistinct)

    expect(writesDistinct).toHaveLength(3) // Organising.md, A.md, B.md
    const orgWrite = writesDistinct.find(w => w.home.path === "Organising.md")!
    const aWrite = writesDistinct.find(w => w.home.path === "A.md")!
    const bWrite = writesDistinct.find(w => w.home.path === "B.md")!

    expect(orgWrite.children.map(l => l.text)).toEqual(["[[A]]", "[[B]]"])
    expect(aWrite.mentions.length).toBe(1) // Has the mention from dailyNoteA
    expect(bWrite.mentions.length).toBe(1) // Has the mention from dailyNoteB

    // Second: siblings resolving to the same home get merged into one SectionWrite.
    const resolveHomeSame = (): OrganiseHome => ({ path: "Common.md", exists: false })

    const writesSame = planOrganiseWrites(g, tree, rootHome, checkAll, resolveHomeSame)

    expect(writesSame).toHaveLength(2) // Organising.md, Common.md
    const orgWriteSame = writesSame.find(w => w.home.path === "Organising.md")!
    const commonWrite = writesSame.find(w => w.home.path === "Common.md")!

    // A and B themselves are added to root's .children (they're page-children of root)
    expect(orgWriteSame.children.map(l => l.text)).toEqual(["[[A]]", "[[B]]"])
    // Their descendants merge into Common.md
    expect(commonWrite.mentions.length).toBe(2) // Both mentions end up here
  })

  it("resolves homes correctly at depth > 1, chaining through lazy homeThunk", () => {
    // Build: Parent -> Child -> Grandchild (all pages via nested wikilinks).
    // Grandchild.md's own body carries a text line mentioning itself
    // ("important note") - this used to (mis)report as a mention needing a
    // home, until mergePageNode's location-stickiness bug (../graph/graph.ts)
    // was fixed: [[grandchild]] is first registered as a bare-wikilink
    // reference while indexing Child.md's "- [[Grandchild]]" line, then
    // re-registered as a real page while indexing Grandchild.md itself.
    // mergePageNode now correctly adopts the real file's location on that
    // transition, so [[grandchild]]'s canonical location becomes Grandchild.md
    // (previously it stayed stuck at Child.md forever). That makes
    // buildPullTree's own-body exclusion (ownBodyPath, ../search/pull.ts)
    // correctly recognize the "important note" line as [[Grandchild]]'s own
    // body - not a mention to route anywhere - so it's excluded entirely.
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

    const writes = planOrganiseWrites(g, tree, rootHome, checkAll, resolveHome)

    // Only two homes: root and Child.md. Grandchild.md never gets a
    // SectionWrite at all, since its only content is its own already-there
    // body line, correctly excluded as own-body rather than surfaced as a
    // mention (see comment above the test).
    expect(writes).toHaveLength(2)

    // Root (Organising.md) contains [[Child]].
    const rootWrite = writes.find(w => w.home.path === "Organising.md")!
    expect(rootWrite.children.map(l => l.text)).toEqual(["[[Child]]"])
    expect(rootWrite.mentions).toEqual([])

    // Child.md contains [[Grandchild]] - the "chaining through lazy
    // homeThunk" this test targets: [[Grandchild]] is a page-child of
    // [[Child]], so its link lands in [[Child]]'s resolved home (Child.md),
    // NOT nested inline under root, before recursing into [[Grandchild]]'s
    // own resolved home for its descendants.
    const childWrite = writes.find(w => w.home.path === "Child.md")!
    expect(childWrite.children.map(l => l.text)).toEqual(["[[Grandchild]]"])
    expect(childWrite.mentions).toEqual([])

    // Grandchild.md is never even created as a home - there is nothing left
    // to route there once its own body content is correctly excluded.
    expect(writes.find(w => w.home.path === "Grandchild.md")).toBeUndefined()
  })
})

// ── Nested plain-text children keep their indentation ───────────────────────────

describe("planOrganiseWrites - nested text children", () => {
  it("threads real nesting depth through a chain of plain-text sub-bullets", () => {
    // A bullet mentioning two pages, with a plain (non-wikilink) sub-bullet
    // nested under it - this used to flatten onto the same depth as its
    // parent once written out, losing the source's nesting.
    const note = parse(
      "- [[A]] [[B]] notes\n  - [Titus Winters - Software Engineering Gaps](https://example.com) 2024-06-02",
      "Source.md",
    )
    const g = buildGraph(note)

    const tree = buildPullTree(g, "[[a]]")!
    expect(tree.children).toHaveLength(1)
    const parentLine = tree.children[0]
    expect(parentLine.children).toHaveLength(1)

    const rootHome: OrganiseHome = { path: "Organising.md", exists: true }
    const writes = planOrganiseWrites(g, tree, rootHome, checkAll, () => rootHome)

    const write = writes.find(w => w.home.path === "Organising.md")!
    expect(write.mentions.map(l => l.depth)).toEqual([0, 1])
    expect(write.mentions[0].text).toContain("notes")
    expect(write.mentions[1].text).toContain("Titus Winters")

    // Rendered output preserves the nested sub-bullet as an indented child,
    // not a flattened sibling.
    const rendered = write.mentions.map(renderPullLine)
    expect(rendered[0]).toBe(`- ${write.mentions[0].text}`)
    expect(rendered[1]).toBe(`    - ${write.mentions[1].text}`)
  })

  it("splices in extraLinesOf's lines right after a mention's own line, undated, without recursing into them", () => {
    // extraLinesOf models what a vault-aware caller (collectUnindexedChildLines
    // in obsidian-utils.ts) would return for plain-text sub-bullets the
    // indexer skipped entirely - they never become PullNode children at all,
    // so this is the only way they can reach the write plan.
    const note = parse("- [[A]] notes", "Source.md")
    const g = buildGraph(note)
    const tree = buildPullTree(g, "[[a]]")!
    const mentionNode = tree.children[0]

    const rootHome: OrganiseHome = { path: "Organising.md", exists: true }
    const extraLinesOf = (node: PullNode, depth: number): PullLine[] =>
      node.key === mentionNode.key ? [{ depth: depth + 1, text: "test2" }, { depth: depth + 1, text: "test3" }] : []

    const writes = planOrganiseWrites(g, tree, rootHome, checkAll, () => rootHome, extraLinesOf)

    const write = writes.find(w => w.home.path === "Organising.md")!
    expect(write.mentions).toEqual([
      { depth: 0, text: "[[A]] notes" },
      { depth: 1, text: "test2" },
      { depth: 1, text: "test3" },
    ])
  })

  it("splices in extraLinesOf's lines right after a bare-link page-child's own link, at depth relative to 0", () => {
    // A bare `- [[A]]` bullet (nothing else on the line) collapses to a
    // structural page->page edge, not a text mention - extraLinesOf must
    // still be consulted for it, so plain-text sub-bullets nested under a
    // bare link aren't silently dropped either.
    const note = parse("- [[Root]]\n  - [[A]]\n    - some detail\n    - more detail", "Source.md")
    const g = buildGraph(note)
    const tree = buildPullTree(g, "[[root]]")!
    const pageChild = tree.children[0]
    expect(pageChild.key).toBe("[[a]]")
    expect(pageChild.node.nodeType).toBe("page")
    expect(pageChild.children).toEqual([]) // "some detail"/"more detail" never became graph nodes

    const rootHome: OrganiseHome = { path: "Organising.md", exists: true }
    const extraLinesOf = (node: PullNode, depth: number): PullLine[] =>
      node.key === pageChild.key
        ? [{ depth: depth + 1, text: "some detail" }, { depth: depth + 1, text: "more detail" }]
        : []

    const writes = planOrganiseWrites(g, tree, rootHome, checkAll, () => rootHome, extraLinesOf)

    const write = writes.find(w => w.home.path === "Organising.md")!
    expect(write.children).toEqual([
      { depth: 0, text: "[[A]]" },
      { depth: 1, text: "some detail" },
      { depth: 1, text: "more detail" },
    ])
    expect(write.mentions).toEqual([])
  })
})

// ── Organise -> reindex -> re-organise idempotency ──────────────────────────────

/**
 * Mirrors the file-mutation core of `applyOrganisePlan` (src/obsidian-utils.ts,
 * covered separately in src/__tests__/apply-organise-plan.test.ts): per
 * touched path, apply that path's deletions (descending line order, against
 * the original content) and then upsert its section write, if any. Can't
 * import `applyOrganisePlan` itself here - it pulls in the `obsidian` value
 * module, which only `src/` (with its bunfig.toml preload) can load - so
 * this reproduces just its pure string-munging half against a plain
 * `Map<string, string>` standing in for the vault.
 */
function applyPlanToFiles(files: Map<string, string>, writes: SectionWrite[], deletions: PullDeletion[]): void {
  const deletionsByPath = new Map<string, PullDeletion[]>()
  for (const d of deletions) {
    if (!deletionsByPath.has(d.location.path)) deletionsByPath.set(d.location.path, [])
    deletionsByPath.get(d.location.path)!.push(d)
  }
  const writesByPath = new Map(writes.map(w => [w.home.path, w]))
  const touched = new Set([...deletionsByPath.keys(), ...writesByPath.keys()])

  for (const path of touched) {
    const write = writesByPath.get(path)
    const lines = (files.get(path) ?? "").split("\n")
    const dels = deletionsByPath.get(path)
    if (dels) {
      const sorted = [...dels].sort((a, b) => b.location.position.start.line - a.location.position.start.line)
      for (const d of sorted) lines.splice(d.location.position.start.line, 1)
    }
    let content = lines.join("\n")
    if (write) {
      content = upsertOrganiseSections(content, write.children.map(renderPullLine), write.mentions.map(renderPullLine))
    }
    files.set(path, content)
  }
}

describe("Organise -> reindex -> re-organise idempotency", () => {
  // Parent.md has an ad hoc `- [[Child]]` bullet, and a daily note mentions
  // [[Child]] once. This test proves true idempotency through the REAL
  // incremental-reindex primitive (`reindexFileInGraph`), rather than an
  // idealized from-scratch `buildGraph` rebuild:
  //  - Only `writes.map(w => w.home.path)` - the SectionWrite homes,
  //    sequentially, in that order - are incrementally reindexed below, via
  //    `reindexFileInGraph` (../graph/builder.ts), which mutates the SAME
  //    long-lived graph object in place (`removeByPath` + re-add for one
  //    file at a time). A deletion-only source file (the daily note here)
  //    is deliberately left out of that list, so its removal from disk is
  //    not reflected in the graph by this path - this is why one stale
  //    mention legitimately survives below. `OrganiseView.handleApplied`
  //    (src/view/organise-notes/OrganiseView.tsx) no longer mirrors this
  //    partial refresh in production - it runs a full reindex instead,
  //    specifically to close this staleness window (a partial refresh let a
  //    later deletion's stale line number land on the wrong line, sometimes
  //    the frontmatter delimiter, in a deletion-only file) - but the
  //    staleness this test captures remains true of the underlying
  //    incremental primitive, and is worth pinning here regardless of what
  //    calls it - see the comment where it's asserted, further down.
  //  - An earlier version of this test built a fresh `buildGraph` for the
  //    "post-organise" state and hand-picked an indexing order that made
  //    everything look idempotent. That was a false-confidence test: a
  //    fresh rebuild with a cherry-picked order doesn't prove anything about
  //    what the real incremental path does. This version uses the real
  //    `reindexFileInGraph` against the real graph instead - infrastructure
  //    worth keeping even now that the bug that originally motivated
  //    writing it this way (`mergePageNode`'s location-stickiness,
  //    ../graph/graph.ts) is fixed, since it's what makes this a REAL
  //    production-path test rather than an idealized one.
  it("does not re-offer content a prior organise run already delivered, via the real incremental reindex path", async () => {
    const parentContent1 = "- [[Child]]"
    const dailyContent1 = "- [[Child]] some detail"
    const parentPage1 = parse(parentContent1, "Parent.md")
    const dailyNote1 = parse(dailyContent1, "2025-03-20.md")
    const g = buildGraph(parentPage1, dailyNote1)
    const tree1 = buildPullTree(g, "[[parent]]")!

    const rootHome: OrganiseHome = { path: "Parent.md", exists: true }
    const resolveHome1 = (key: string): OrganiseHome =>
      key === "[[child]]" ? { path: "Child.md", exists: false } : rootHome

    const writes1 = planOrganiseWrites(g, tree1, rootHome, checkAll, resolveHome1)
    const dels1 = planDeletions(g, tree1, checkAll)

    // Sanity check on the "before" state: both homes get a write, and both
    // source lines (Parent.md's ad hoc bullet and the daily note's mention
    // line) are deletion candidates. This is also, concretely,
    // `writes.map(w => w.home.path)` - the exact order `handleApplied`
    // would refresh in: Parent.md (root's own home, visited first), then
    // Child.md (the child page's resolved home, visited during recursion).
    expect(writes1.map(w => w.home.path)).toEqual(["Parent.md", "Child.md"])
    expect(dels1).toHaveLength(2)

    // Compute the real post-organise file contents the same way
    // `applyOrganisePlan` would (deletions then upsert, per file).
    const files = new Map<string, string>([
      ["Parent.md", parentContent1],
      ["2025-03-20.md", dailyContent1],
    ])
    applyPlanToFiles(files, writes1, dels1)

    // A fake VaultScanner backed by that same map - `reindexFileInGraph`
    // only ever calls `readFile`, never `walkVault`, for a single-file
    // incremental reindex.
    const scanner: VaultScanner = {
      walkVault: async () => ({ files: [], folders: [] }),
      readFile: async (relPath: string) => ({ content: files.get(relPath) ?? "", mtime: 1_700_000_000_000 }),
    }

    // Incrementally reindex, on the SAME graph `g` from the first run, in
    // the exact order production uses: writes1.map(w => w.home.path).
    // 2025-03-20.md (deletion-only) is deliberately NOT reindexed here -
    // matching handleApplied exactly.
    for (const path of writes1.map(w => w.home.path)) {
      await reindexFileInGraph(path, g, scanner, DEFAULT_SETTINGS)
    }

    // Fix, asserted directly: [[child]] was first registered as a
    // *reference* while indexing Parent.md's original `- [[Child]]` bullet
    // (before Child.md existed at all), then re-registered as a real page
    // once Child.md was created and incrementally reindexed above.
    // `NotesGraph.mergePageNode` (../graph/graph.ts) now correctly adopts
    // the real file's own location on that reference-to-real transition, so
    // [[child]]'s canonical location is Child.md, not stuck at Parent.md
    // (where it was first merely mentioned).
    const childAttrs = g.getNodeAttributes("[[child]]")
    expect(childAttrs.isReference).toBe(false) // correctly promoted to a real page...
    expect(childAttrs.location.path).toBe("Child.md") // ...with the correct, authoritative location.

    // Consequence: buildPullTree's own-body exclusion (`ownBodyPath`,
    // ../search/pull.ts) compares an edge's location to [[child]]'s
    // canonical location to decide whether a child is [[Child]]'s own body.
    // Now that this location is correct (Child.md), the mention line living
    // inside Child.md's own `organise:mentions` section - the exact content
    // the first organise run just delivered there - IS recognized as
    // own-body, and is correctly excluded rather than pulled right back in
    // as a fresh candidate.
    const tree2 = buildPullTree(g, "[[parent]]")!
    const resolveHome2 = (key: string): OrganiseHome =>
      key === "[[child]]" ? { path: "Child.md", exists: true } : rootHome

    const writes2 = planOrganiseWrites(g, tree2, rootHome, checkAll, resolveHome2)
    const dels2 = planDeletions(g, tree2, checkAll)

    const childWrite2 = writes2.find(w => w.home.path === "Child.md")
    expect(childWrite2).toBeDefined()
    // Exactly one mention, not two and not zero: Child.md's own
    // already-organised content is correctly excluded as own-body (the
    // duplication/double-dating bug is gone), but the graph still holds one
    // STALE edge from the original daily note line - 2025-03-20.md is
    // deletion-only, so `handleApplied` never reindexes it (see the comment
    // above this test), and its now-deleted-on-disk mention lingers in the
    // graph until a real `vault.on("modify")` event catches up. That's a
    // separate, already-understood staleness window, not a regression of
    // this fix.
    expect(childWrite2!.children).toEqual([])
    expect(childWrite2!.mentions.map(l => l.text)).toEqual([
      "[[Child]] some detail 2025-03-20",
    ])

    // Deletions: the stale daily-note line is offered again (safe, if
    // redundant, since it's already gone from disk), and Parent.md's own
    // `organise:children` line for [[Child]] is *also* offered - not a
    // regression, but the direct consequence of the own-body exemption in
    // `isSafeToDeleteSource` (../search/pull.ts): [[Child]] now has real
    // content of its own (the mention living inside Child.md), and that
    // content is exempt from the "every child checked" requirement (it's
    // never lost by removing *this* reference bullet - it stays put in
    // Child.md regardless). Without that exemption, a real page that has
    // accumulated any content of its own could never have a bullet
    // referencing it offered for deletion again - which is exactly what
    // blocks reparenting: hand-nesting a link under another inside an
    // already-written `organise:children` section only produces a
    // deletable source line once the target has real content, and that's
    // the normal case for "consolidate notes", not an edge case.
    const delPaths = dels2.map(d => d.location.path).sort()
    expect(delPaths).toEqual(["2025-03-20.md", "Parent.md"])

    // Parent.md is (harmlessly) offered [[Child]] as a child link - that
    // text exactly matches what's already inside Parent.md's own
    // `organise:children` section, so even though its old line is also
    // offered for deletion above, re-applying the write through
    // `upsertOrganiseSections` (tested in organise-sections.test.ts) puts
    // it right back - a genuine no-op end to end, verified below.
    const parentWrite2 = writes2.find(w => w.home.path === "Parent.md")!
    expect(parentWrite2.children.map(l => l.text)).toEqual(["[[Child]]"])

    // Verify that end-to-end: applying this second round to the same
    // post-round-1 file contents leaves Parent.md byte-for-byte unchanged,
    // does not duplicate anything in Child.md, and only removes the stale
    // daily-note line.
    const parentBefore = files.get("Parent.md")
    applyPlanToFiles(files, writes2, dels2)
    expect(files.get("Parent.md")).toBe(parentBefore)
    expect(files.get("2025-03-20.md")).toBe("")
    expect(files.get("Child.md")).toContain("[[Child]] some detail 2025-03-20")
  })
})

// ── Reparenting via a hand-nested organise:children link ───────────────────────

describe("Reparenting via a hand-nested organise:children link", () => {
  it("deletes both a page bullet and its newly-nested child even once the child's target has its own real body content", () => {
    // [[A]] already has real content of its own (e.g. from an earlier
    // organise run, or just because it's a pre-existing note), and the
    // user hand-nests "- [[B]]" under "- [[A]]" inside Root.md - no
    // different, to the parser, than nesting a link anywhere else in the
    // vault (list-scanner.ts doesn't special-case `organise:children`).
    // Before the own-body exemption in `isSafeToDeleteSource`, [[A]]'s own
    // "## Notes" header/body edges - never offered as pull candidates, so
    // never in `checkedKeys` - permanently blocked deleting *any* bullet
    // referencing [[A]], which is exactly what stood in the way of ever
    // collapsing Root.md's now-redundant nested line.
    const rootPage = parse("- [[A]]\n  - [[B]]", "Root.md")
    const aPage = parse("## Notes\n- some existing detail", "A.md")
    const g = buildGraph(rootPage, aPage)

    const tree = buildPullTree(g, "[[root]]")!
    const deletions = planDeletions(g, tree, checkAll)

    expect(deletions.map(d => d.location.path)).toEqual(["Root.md", "Root.md"])
    expect(deletions.map(d => d.key).sort()).toEqual(["[[a]]", "[[b]]"])
  })

  it("collapses the organising note and files the reparented child into its target's own home, end to end", () => {
    // The concrete scenario from the feature request: Root.md was already
    // organised once (a flat "- [[A]]" / "- [[B]]" inside its managed
    // section), [[A]] has since accumulated real content of its own, and
    // the user hand-nests "- [[B]]" under "- [[A]]" inside that same
    // section. A single buildGraph (rather than the incremental-reindex
    // harness above) is enough here - unlike the idempotency test, this
    // isn't probing a multi-round graph-mutation bug, just the one-shot
    // plan/apply outcome for an already-saved, already-reindexed file.
    const rootContent =
      "<!-- organise:children -->\n" +
      "- [[A]]\n" +
      "  - [[B]]\n" +
      "<!-- /organise:children -->\n" +
      "\n" +
      "<!-- organise:mentions -->\n" +
      "<!-- /organise:mentions -->"
    const aContent = "## Notes\n- some existing detail"

    const rootPage = parse(rootContent, "Root.md")
    const aPage = parse(aContent, "A.md")
    const g = buildGraph(rootPage, aPage)

    const tree = buildPullTree(g, "[[root]]")!
    const rootHome: OrganiseHome = { path: "Root.md", exists: true }
    const resolveHome = (key: string): OrganiseHome =>
      key === "[[a]]" ? { path: "A.md", exists: true } : rootHome

    const writes = planOrganiseWrites(g, tree, rootHome, checkAll, resolveHome)
    const deletions = planDeletions(g, tree, checkAll)

    const files = new Map<string, string>([
      ["Root.md", rootContent],
      ["A.md", aContent],
    ])
    applyPlanToFiles(files, writes, deletions)

    // [[B]] moved out: Root.md's own section collapses back to a flat
    // "- [[A]]", with no leftover nested "[[B]]" anywhere in it.
    expect(files.get("Root.md")).toBe(
      "<!-- organise:children -->\n" +
      "- [[A]]\n" +
      "<!-- /organise:children -->\n" +
      "\n" +
      "<!-- organise:mentions -->\n" +
      "<!-- /organise:mentions -->"
    )

    // ...and filed into [[A]]'s own home, alongside its pre-existing body.
    expect(files.get("A.md")).toBe(
      "<!-- organise:children -->\n" +
      "- [[B]]\n" +
      "<!-- /organise:children -->\n" +
      "\n" +
      "<!-- organise:mentions -->\n" +
      "<!-- /organise:mentions -->\n" +
      "\n" +
      "## Notes\n" +
      "- some existing detail"
    )
  })
})

// ── Frontmatter-declared parent relation ─────────────────────────────────────

describe("Consolidating a parent that a child declares via frontmatter `parent:`", () => {
  it("never deletes the child's frontmatter delimiter, and still files the child's mentions into its own note", () => {
    // The indexer records a frontmatter `parent: "[[Root]]"` edge at the
    // child page's own location - line 0 of Child.md, its opening `---`.
    // There is no bullet to remove or relocate: the hierarchy is already
    // declared where it belongs.
    const rootContent = "---\ntags: [x]\n---\n- intro"
    const childContent = "---\nparent: \"[[Root]]\"\n---\n- own detail"
    const dailyContent = "- [[Child]] met today"
    const g = buildGraph(parse(rootContent, "Root.md"), parse(childContent, "Child.md"), parse(dailyContent, "2025-03-20.md"))

    const tree = buildPullTree(g, "[[root]]")!
    const rootHome: OrganiseHome = { path: "Root.md", exists: true }
    const resolveHome = (key: string): OrganiseHome =>
      key === "[[child]]" ? { path: "Child.md", exists: true } : rootHome

    const writes = planOrganiseWrites(g, tree, rootHome, checkAll, resolveHome)
    const deletions = planDeletions(g, tree, checkAll)

    const files = new Map<string, string>([
      ["Root.md", rootContent],
      ["Child.md", childContent],
      ["2025-03-20.md", dailyContent],
    ])
    applyPlanToFiles(files, writes, deletions)

    expect(files.get("Root.md")).toBe(rootContent)
    expect(files.get("Child.md")).toBe(
      "---\nparent: \"[[Root]]\"\n---\n" +
      "<!-- organise:children -->\n" +
      "<!-- /organise:children -->\n" +
      "\n" +
      "<!-- organise:mentions -->\n" +
      "- [[Child]] met today 2025-03-20\n" +
      "<!-- /organise:mentions -->\n" +
      "\n" +
      "- own detail"
    )
    expect(files.get("2025-03-20.md")).toBe("")
  })
})

// ── Selective consolidation (sub-topic rows unchecked) ───────────────────────

describe("Selective consolidation", () => {
  it("still files a checked mention whose parent topic row is unchecked", () => {
    // The consolidate pane leaves sub-topic rows unchecked by default; the
    // user must still be able to check an individual line beneath one.
    const g = buildGraph(
      parse("- [[Parent]]\n  - [[Child]]", "2025-03-20.md"),
      parse("- [[Child]] http://test-url\n- [[Child]] test note without url", "2025-03-22.md"),
    )
    const tree = buildPullTree(g, "[[parent]]")!
    const childKey = tree.children[0].key
    const isChecked = (key: string) => key !== childKey
    const rootHome: OrganiseHome = { path: "Organising.md", exists: true }
    const resolveHome = (key: string): OrganiseHome =>
      key === "[[child]]" ? { path: "Child.md", exists: true } : rootHome

    const writes = planOrganiseWrites(g, tree, rootHome, isChecked, resolveHome)
    expect(writes.map(w => w.home.path)).toEqual(["Child.md"])
    expect(writes[0].mentions.map(l => l.text)).toEqual([
      "[[Child]] [http://test-url](http://test-url) 2025-03-22",
      "[[Child]] test note without url 2025-03-22",
    ])

    const deletions = planDeletions(g, tree, isChecked)
    expect(deletions.map(d => d.location.path)).toEqual(["2025-03-22.md", "2025-03-22.md"])
  })

  it("promotes a checked sub-line to its unchecked parent mention's depth", () => {
    const g = buildGraph(parse(
      "- [[A]] [[B]] notes\n  - [Gaps](https://example.com) 2024-06-02",
      "Source.md",
    ))
    const tree = buildPullTree(g, "[[a]]")!
    const parentLine = tree.children[0]
    const rootHome: OrganiseHome = { path: "Organising.md", exists: true }

    const writes = planOrganiseWrites(g, tree, rootHome, key => key !== parentLine.key, () => rootHome)
    expect(writes[0].mentions.map(l => l.depth)).toEqual([0])
    expect(writes[0].mentions[0].text).toContain("Gaps")
  })

  it("never deletes a checked line while an unchecked line stays nested under it", () => {
    // Deleting "meeting" would leave "[[Topic]]" and its unchecked detail
    // re-parented under whatever bullet precedes them in the daily note.
    const daily = "- [[Root]] meeting\n  - [[Topic]]\n    - detail http://x.com"
    const g = buildGraph(parse(daily, "2025-03-20.md"))
    const tree = buildPullTree(g, "[[root]]")!
    const detailKey = tree.children[0].children[0].children[0].key

    const deletions = planDeletions(g, tree, key => key !== detailKey)
    expect(deletions).toEqual([])
  })

  it("never deletes a line whose nested child is placed elsewhere in the tree and so stays behind", () => {
    // Himalaya.md shape: [[Risks]] is nested under [[Program]], but Risks.md
    // also declares `parent: [[Root]]`, so the pull tree places [[Risks]] at
    // its frontmatter position (never deleted). Deleting Program's line
    // would leave "- [[Risks]]" re-parented under the preceding bullet.
    const g = buildGraph(
      parse("---\nparent: \"[[Root]]\"\n---\n", "Risks.md"),
      parse("- [[Other]]\n- [[Program]]\n\t- [[Risks]]", "Root.md"),
    )
    const tree = buildPullTree(g, "[[root]]")!
    expect(tree.children.map(c => c.key)).toContain("[[risks]]")

    const deletedLines = planDeletions(g, tree, checkAll)
      .filter(d => d.location.path === "Root.md")
      .map(d => d.location.position.start.line)
    expect(deletedLines).not.toContain(1)
    expect(deletedLines).not.toContain(2)
  })

  it("deletes a moved line even when its topic is mentioned, unchecked, in another note", () => {
    // 2024-Aug-W32 shape: "[[Costs]]" is nested under "[[Root]]" in a weekly
    // note, and [[Costs]] is also mentioned in a later daily note. That
    // mention (a sub-topic row, unchecked by default) is not nested under
    // the weekly line, so it must not turn the move into a copy.
    const g = buildGraph(
      parse("- [[Root]]\n  - [[Costs]]", "2024-08-10.md"),
      parse("- [[Costs]] explorer notes http://x.com", "2025-05-01.md"),
    )
    const tree = buildPullTree(g, "[[root]]")!
    const costs = tree.children.find(c => c.key === "[[costs]]")!
    const mentionKey = costs.children[0].key

    const deletions = planDeletions(g, tree, key => key !== mentionKey)
    expect(deletions.map(d => `${d.location.path}:${d.location.position.start.line}`)).toEqual(["2024-08-10.md:1"])
  })
})
