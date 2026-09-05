import { describe, it, expect } from "bun:test"
import type { PageNode, PullNode, TextNode } from "@mdtree/core"
import { collectUnindexedChildLines } from "../obsidian-utils"

// ── Fake vault ───────────────────────────────────────────────────────────────
//
// collectUnindexedChildLines only ever calls `getFileByPath` and `read`, so
// this fakes just that slice of `app.vault`, backed by a plain
// `Map<string, string>` of path -> content (same pattern as
// apply-organise-plan.test.ts).

function fakeApp(files: Record<string, string>) {
    const map = new Map(Object.entries(files))
    const vault = {
        getFileByPath: (path: string) => (map.has(path) ? { path } : null),
        read: async (file: { path: string }) => map.get(file.path) ?? "",
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { vault } as any
}

const loc = (path: string, line: number) => ({
    path,
    position: { start: { line, ch: 0 }, end: { line, ch: 0 } },
})

function makeTextNode(path: string, line: number): TextNode {
    return {
        nodeType: "text",
        location: loc(path, line),
        searchKey: "anchor",
        parsedTokens: [{ tokenType: "text", text: "anchor", decoration: "none" }],
        tags: [],
        isTask: false,
        isCompleted: false,
        boost: 1,
        ageDays: 0,
    }
}

function makePageNode(path: string, line: number): PageNode {
    return {
        nodeType: "page",
        isReference: true,
        page: "Anchor",
        aliases: [],
        tags: [],
        location: loc(path, line),
        searchKey: "anchor",
        boost: 1,
        ageDays: 0,
    }
}

function pullNode(node: TextNode | PageNode, children: PullNode[] = []): PullNode {
    return { key: "[[anchor]]", node, children }
}

describe("collectUnindexedChildLines", () => {
    it("returns an empty array when the anchor's file no longer exists", async () => {
        const app = fakeApp({})
        const node = pullNode(makeTextNode("Gone.md", 0))

        expect(await collectUnindexedChildLines(app, node)).toEqual([])
    })

    it("collects plain-text sibling lines nested one level under a text-mention anchor", async () => {
        const content = ["- [[Joe]] meeting notes", "  - some note", "  - some other note", "- [[Other]]"].join("\n")
        const app = fakeApp({ "Daily.md": content })
        const node = pullNode(makeTextNode("Daily.md", 0))

        expect(await collectUnindexedChildLines(app, node)).toEqual([
            { depth: 1, text: "some note" },
            { depth: 1, text: "some other note" },
        ])
    })

    it("collects the same way under a bare-link page anchor - the function is indifferent to nodeType", async () => {
        const content = ["- [[Joe]]", "  - discussed roadmap", "  - blocked on X"].join("\n")
        const app = fakeApp({ "Daily.md": content })
        const node = pullNode(makePageNode("Daily.md", 0))

        expect(await collectUnindexedChildLines(app, node)).toEqual([
            { depth: 1, text: "discussed roadmap" },
            { depth: 1, text: "blocked on X" },
        ])
    })

    it("tracks multi-level nesting depth relative to the anchor", async () => {
        const content = ["- [[Joe]] meeting notes", "  - detail 1", "    - detail 1a", "  - detail 2"].join("\n")
        const app = fakeApp({ "Daily.md": content })
        const node = pullNode(makeTextNode("Daily.md", 0))

        expect(await collectUnindexedChildLines(app, node)).toEqual([
            { depth: 1, text: "detail 1" },
            { depth: 2, text: "detail 1a" },
            { depth: 1, text: "detail 2" },
        ])
    })

    it("skips a line that's already one of the node's own indexed children, along with everything nested under it", async () => {
        const content = [
            "- [[Joe]] meeting notes",
            "  - [[Real]] child", // an indexed PullNode child, at line 1
            "    - nested under the real child - handled by that child's own scan",
            "  - plain sibling",
        ].join("\n")
        const app = fakeApp({ "Daily.md": content })
        const realChild = pullNode(makeTextNode("Daily.md", 1))
        const node = pullNode(makeTextNode("Daily.md", 0), [realChild])

        expect(await collectUnindexedChildLines(app, node)).toEqual([{ depth: 1, text: "plain sibling" }])
    })

    it("does not let a blank line inside the span terminate collection early", async () => {
        const content = ["- [[Joe]] meeting notes", "  - detail 1", "", "  - detail 2"].join("\n")
        const app = fakeApp({ "Daily.md": content })
        const node = pullNode(makeTextNode("Daily.md", 0))

        expect(await collectUnindexedChildLines(app, node)).toEqual([
            { depth: 1, text: "detail 1" },
            { depth: 1, text: "detail 2" },
        ])
    })

    it("stops once indentation returns to at or below the anchor's own indent", async () => {
        const content = ["- [[Joe]] meeting notes", "  - detail 1", "- [[Sibling]]", "  - unrelated detail"].join("\n")
        const app = fakeApp({ "Daily.md": content })
        const node = pullNode(makeTextNode("Daily.md", 0))

        expect(await collectUnindexedChildLines(app, node)).toEqual([{ depth: 1, text: "detail 1" }])
    })
})
