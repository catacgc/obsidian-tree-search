import { describe, it, expect } from "bun:test"
import type { PullDeletion, SectionWrite } from "@mdtree/core"
import { applyOrganisePlan } from "../obsidian-utils"

// ── Fake vault ───────────────────────────────────────────────────────────────
//
// No real Obsidian runtime is available under `bun test`, so this fakes just
// the slice of `app.vault` that `applyOrganisePlan` touches
// (`getFileByPath`, `create`, `read`, `modify`), backed by a plain
// `Map<string, string>` of path -> content. `getFileByPath` returns a
// lightweight `{ path }` stand-in for `TFile` - `applyOrganisePlan` only
// ever threads that object back into `read`/`modify`/`create`, never
// inspects its shape.

function makeFakeVault(initial: Record<string, string> = {}) {
    const files = new Map<string, string>(Object.entries(initial))
    const reads: string[] = []
    const modifies: string[] = []
    const creates: string[] = []

    const vault = {
        getFileByPath: (path: string) => (files.has(path) ? { path } : null),
        create: async (path: string, content: string) => {
            creates.push(path)
            files.set(path, content)
            return { path }
        },
        read: async (file: { path: string }) => {
            reads.push(file.path)
            return files.get(file.path) ?? ""
        },
        modify: async (file: { path: string }, content: string) => {
            modifies.push(file.path)
            files.set(file.path, content)
        },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app: any = { vault }

    return { app, files, reads, modifies, creates }
}

const loc = (path: string, line: number) => ({
    path,
    position: { start: { line, ch: 0 }, end: { line, ch: 0 } },
})

function makeWrite(path: string, exists: boolean, children: string[] = [], mentions: string[] = []): SectionWrite {
    return {
        home: { path, exists },
        children: children.map(text => ({ depth: 0, text })),
        mentions: mentions.map(text => ({ depth: 0, text })),
    }
}

function makeDeletion(key: string, path: string, line: number): PullDeletion {
    return { key, location: loc(path, line) }
}

describe("applyOrganisePlan", () => {
    it("creates a new home file and writes its sections", async () => {
        const { app, files } = makeFakeVault()
        const write = makeWrite("Child.md", false, ["[[Grandchild]]"], ["[[Child]] some detail 2025-03-20"])

        await applyOrganisePlan(app, [write], [])

        const content = files.get("Child.md")
        expect(content).toBeDefined()
        expect(content).toContain("<!-- organise:children -->")
        expect(content).toContain("- [[Grandchild]]")
        expect(content).toContain("<!-- /organise:children -->")
        expect(content).toContain("<!-- organise:mentions -->")
        expect(content).toContain("- [[Child]] some detail 2025-03-20")
        expect(content).toContain("<!-- /organise:mentions -->")
    })

    it("updates an existing home file's sections in place, preserving the rest of the note", async () => {
        const existing = [
            "---",
            "tags: [foo]",
            "---",
            "<!-- organise:children -->",
            "- [[Old]]",
            "<!-- /organise:children -->",
            "",
            "<!-- organise:mentions -->",
            "<!-- /organise:mentions -->",
            "",
            "# Body",
            "Some hand-written content that must survive.",
        ].join("\n")
        const { app, files } = makeFakeVault({ "Child.md": existing })
        const write = makeWrite("Child.md", true, ["[[New]]"], ["[[Child]] a new mention 2025-03-20"])

        await applyOrganisePlan(app, [write], [])

        const content = files.get("Child.md")!
        // Upserted in place: old children line still there (dedup keeps
        // existing content), new line appended within the same markers.
        expect(content).toContain("- [[Old]]")
        expect(content).toContain("- [[New]]")
        expect(content).toContain("- [[Child]] a new mention 2025-03-20")
        // Untouched frontmatter and body survived the round trip.
        expect(content).toContain("tags: [foo]")
        expect(content).toContain("# Body")
        expect(content).toContain("Some hand-written content that must survive.")
    })

    it("applies deletions and a section write to the same file in a single read/modify", async () => {
        const existing = ["line0 keep", "line1 DELETE ME", "line2 keep", "line3 DELETE ME TOO"].join("\n")
        const { app, files, reads, modifies } = makeFakeVault({ "Notes.md": existing })

        const deletions = [makeDeletion("[[a]]", "Notes.md", 1), makeDeletion("[[b]]", "Notes.md", 3)]
        const write = makeWrite("Notes.md", true, ["[[Topic]]"])

        await applyOrganisePlan(app, [write], deletions)

        const content = files.get("Notes.md")!
        expect(content).not.toContain("DELETE ME")
        expect(content).toContain("line0 keep")
        expect(content).toContain("line2 keep")
        expect(content).toContain("- [[Topic]]")

        // Read once, written once, despite the file receiving both a
        // deletion and a section write - per applyOrganisePlan's doc comment.
        expect(reads.filter(p => p === "Notes.md")).toHaveLength(1)
        expect(modifies.filter(p => p === "Notes.md")).toHaveLength(1)
    })

    it("skips a SectionWrite whose children and mentions are both empty - no file is touched", async () => {
        const { app, files, reads, modifies, creates } = makeFakeVault()
        const write = makeWrite("Untouched.md", false, [], [])

        await applyOrganisePlan(app, [write], [])

        expect(files.has("Untouched.md")).toBe(false)
        expect(creates).toHaveLength(0)
        expect(reads).toHaveLength(0)
        expect(modifies).toHaveLength(0)
    })

    it("applies multiple deletions in the same file correctly regardless of the order they're passed in", async () => {
        const existing = ["l0", "l1 DELETE", "l2", "l3 DELETE", "l4", "l5 DELETE"].join("\n")
        const { app, files } = makeFakeVault({ "Notes.md": existing })

        // Passed in ascending line-number order; applyOrganisePlan sorts
        // descending internally so earlier deletions never shift the line
        // numbers of later ones.
        const deletions = [
            makeDeletion("[[a]]", "Notes.md", 1),
            makeDeletion("[[b]]", "Notes.md", 3),
            makeDeletion("[[c]]", "Notes.md", 5),
        ]

        await applyOrganisePlan(app, [], deletions)

        const lines = files.get("Notes.md")!.split("\n")
        expect(lines).toEqual(["l0", "l2", "l4"])
    })
})
