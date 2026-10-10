import { describe, it, expect } from "bun:test"
import yaml from "js-yaml"
import type { App } from "obsidian"
import { StaleLineError, type TextNode } from "@mdtree/core"
import {
    addFrontmatterValue,
    applyNotePatch,
    appendToDailyNote,
    appendUnderLine,
    dailyNotePath,
    deleteSubtree,
    editLine,
    editTaskLine,
    renameVaultFile,
    trashVaultFile,
    reparent,
    writeNoteContents,
    writeWholeNote,
} from "../editing/vault-edits"

// ── Fake app ─────────────────────────────────────────────────────────────────
//
// Map-backed stand-in for the slice of `app` the editor-mode appliers touch
// (see apply-organise-plan.test.ts for the pattern). `getFirstLinkpathDest`
// resolves a link by full path (`<name>.md`) or by basename, like Obsidian's
// shortest-path links; new notes land in the vault root.

type FakeFile = { path: string; name: string; basename: string; extension: string }

function makeFakeApp(initial: Record<string, string> = {}) {
    const files = new Map<string, string>(Object.entries(initial))
    const folders = new Set<string>()
    const trashed: string[] = []

    const file = (path: string): FakeFile => {
        const name = path.split("/").pop()!
        const dot = name.lastIndexOf(".")
        return { path, name, basename: dot > 0 ? name.slice(0, dot) : name, extension: dot > 0 ? name.slice(dot + 1) : "" }
    }
    const lookup = (path: string) => (files.has(path) ? file(path) : null)

    const vault = {
        getFileByPath: lookup,
        getAbstractFileByPath: lookup,
        getFolderByPath: (path: string) => (folders.has(path) ? { path } : null),
        createFolder: async (path: string) => { folders.add(path) },
        create: async (path: string, content: string) => {
            if (files.has(path)) throw new Error(`File already exists: ${path}`)
            files.set(path, content)
            return file(path)
        },
        read: async (f: FakeFile) => files.get(f.path)!,
        process: async (f: FakeFile, fn: (data: string) => string) => {
            const next = fn(files.get(f.path)!)
            files.set(f.path, next)
            return next
        },
    }

    const metadataCache = {
        getFirstLinkpathDest: (name: string, _source: string): FakeFile | null => {
            if (files.has(`${name}.md`)) return file(`${name}.md`)
            const hit = [...files.keys()].find(p => file(p).basename.toLowerCase() === name.toLowerCase() || file(p).name.toLowerCase() === name.toLowerCase())
            return hit ? file(hit) : null
        },
    }

    const fileManager = {
        getNewFileParent: (_source: string) => ({ path: "/" }),
        getAvailablePathForAttachment: async (name: string) => name,
        renameFile: async (f: FakeFile, path: string) => {
            files.set(path, files.get(f.path)!)
            files.delete(f.path)
        },
        trashFile: async (f: FakeFile) => {
            trashed.push(f.path)
            files.delete(f.path)
        },
        processFrontMatter: async (f: FakeFile, fn: (fm: Record<string, unknown>) => void) => {
            const content = files.get(f.path)!
            const m = content.match(/^---\n([\s\S]*?)\n---\n/)
            const fm = ((m && yaml.load(m[1])) ?? {}) as Record<string, unknown>
            fn(fm)
            files.set(f.path, `---\n${yaml.dump(fm)}---\n${m ? content.slice(m[0].length) : content}`)
        },
    }

    // The fake only implements the members the appliers use.
    const app = { vault, metadataCache, fileManager } as unknown as App
    return { app, files, folders, trashed }
}

const now = { format: (f: string) => (f === "HH:mm" ? "09:00" : "2026-09-30") }
const cfg = { folder: "Daily", format: "YYYY-MM-DD", template: "Templates/Daily" }

describe("appendToDailyNote", () => {
    it("creates a missing daily note from its template, then appends the outline", async () => {
        const { app, files, folders } = makeFakeApp({ "Templates/Daily.md": "# {{date}} {{title}} {{time}}\n" })

        const outline = [{ depth: 0, marker: "- ", text: "[[Project X]]" }, { depth: 1, marker: "- ", text: "[[A]] hi" }]
        const result = await appendToDailyNote(app, outline, cfg, now)

        expect(folders.has("Daily")).toBe(true)
        expect(files.get("Daily/2026-09-30.md")).toBe("# 2026-09-30 2026-09-30 09:00\n- [[Project X]]\n    - [[A]] hi\n")
        expect(result.file.path).toBe("Daily/2026-09-30.md")
        expect(result.line).toBe(2)
    })

    it("creates an empty daily note when the template is missing", async () => {
        const { app, files } = makeFakeApp()
        await appendToDailyNote(app, [{ depth: 0, marker: "- ", text: "[[P]]" }, { depth: 1, marker: "- ", text: "x" }], cfg, now)
        expect(files.get("Daily/2026-09-30.md")).toBe("- [[P]]\n    - x\n")
    })
})

describe("writeNoteContents", () => {
    it("creates a new note with a trailing newline", async () => {
        const { app, files } = makeFakeApp()
        const f = await writeNoteContents(app, "New", "Hello", "Daily/2026-09-30.md")
        expect(f.path).toBe("New.md")
        expect(files.get("New.md")).toBe("Hello\n")
    })

    it("appends to an existing note after a blank line", async () => {
        const { app, files } = makeFakeApp({ "Old.md": "x\n" })
        await writeNoteContents(app, "Old", "## Decisions", "Daily/2026-09-30.md")
        expect(files.get("Old.md")).toBe("x\n\n## Decisions\n")
    })

    it("refuses to overwrite a note that appeared at the computed path", async () => {
        const { app, files } = makeFakeApp({ "X.md": "mine\n" })
        app.metadataCache.getFirstLinkpathDest = () => null
        await expect(writeNoteContents(app, "X", "Hello", "")).rejects.toThrow('Note "X" already exists')
        expect(files.get("X.md")).toBe("mine\n")
    })
})

describe("addFrontmatterValue", () => {
    it("sets a missing key, as a list when asked", () => {
        const fm: Record<string, unknown> = {}
        addFrontmatterValue(fm, "is", "project", false)
        addFrontmatterValue(fm, "aliases", "a", true)
        expect(fm).toEqual({ is: "project", aliases: ["a"] })
    })

    it("never overwrites: an equal scalar stays, a different one becomes a list, lists dedupe", () => {
        const fm: Record<string, unknown> = { is: "Project", tags: ["x"], parent: "" }
        addFrontmatterValue(fm, "is", "project ", false)
        expect(fm.is).toBe("Project")
        addFrontmatterValue(fm, "is", "area", false)
        expect(fm.is).toEqual(["Project", "area"])
        addFrontmatterValue(fm, "tags", "X", false)
        addFrontmatterValue(fm, "tags", "y", false)
        expect(fm.tags).toEqual(["x", "y"])
        addFrontmatterValue(fm, "parent", "[[P]]", false)
        expect(fm.parent).toBe("[[P]]")
    })
})

describe("applyNotePatch", () => {
    const patch = { name: "New", aliases: ["nu"], headings: ["Plan"], fields: [{ key: "is", value: "project" }] }

    it("creates a missing note with the heading and frontmatter, and is idempotent", async () => {
        const { app, files } = makeFakeApp()
        const f = await applyNotePatch(app, patch, cfg, now)
        expect(f.path).toBe("New.md")
        const once = files.get("New.md")
        expect(once).toBe("---\naliases:\n  - nu\nis: project\n---\n## Plan\n")
        await applyNotePatch(app, patch, cfg, now)
        expect(files.get("New.md")).toBe(once)
    })

    it("patches today's daily note through its template", async () => {
        const { app, files } = makeFakeApp({ "Templates/Daily.md": "# {{date}}\n" })
        const f = await applyNotePatch(app, { name: "2026-09-30", aliases: [], headings: ["Log"], fields: [] }, cfg, now)
        expect(f.path).toBe("Daily/2026-09-30.md")
        expect(files.get("Daily/2026-09-30.md")).toBe("# 2026-09-30\n\n## Log\n")
    })
})

describe("editLine", () => {
    it("rewrites the expected line", async () => {
        const { app, files } = makeFakeApp({ "a.md": "- one\n- two\n" })
        await editLine(app, "a.md", 1, "- two", "- [[Two]]")
        expect(files.get("a.md")).toBe("- one\n- [[Two]]\n")
    })

    it("throws StaleLineError when the line changed", async () => {
        const { app, files } = makeFakeApp({ "a.md": "- one\n- two\n" })
        await expect(editLine(app, "a.md", 1, "- three", "- 3")).rejects.toBeInstanceOf(StaleLineError)
        expect(files.get("a.md")).toBe("- one\n- two\n")
    })
})

describe("deleteSubtree / trashVaultFile", () => {
    it("deleteSubtree removes the line with every nested line", async () => {
        const { app, files } = makeFakeApp({ "a.md": "- a\n    - a1\n        - a2\n- b\n" })
        await deleteSubtree(app, "a.md", 0, "- a")
        expect(files.get("a.md")).toBe("- b\n")
    })

    it("deleteSubtree throws StaleLineError and writes nothing when the line changed", async () => {
        const { app, files } = makeFakeApp({ "a.md": "- a\n    - a1\n- b\n" })
        await expect(deleteSubtree(app, "a.md", 0, "- x")).rejects.toBeInstanceOf(StaleLineError)
        expect(files.get("a.md")).toBe("- a\n    - a1\n- b\n")
    })

    it("trashVaultFile trashes the file, or throws StaleLineError when it is gone", async () => {
        const { app, trashed } = makeFakeApp({ "P.md": "x" })
        await trashVaultFile(app, "P.md")
        expect(trashed).toEqual(["P.md"])
        await expect(trashVaultFile(app, "P.md")).rejects.toBeInstanceOf(StaleLineError)
    })
})

describe("editTaskLine", () => {
    const MONDAY = new Date(2026, 9, 5, 9)
    const task = (line: number, key = "call [[bob]]"): TextNode => ({
        nodeType: "text", searchKey: key, boost: 0, ageDays: 0, tags: [], isTask: true, isCompleted: false,
        parsedTokens: [{ tokenType: "obsidian_link", source: "[[Bob]]", pageTarget: "Bob" }],
        location: { path: "a.md", position: { start: { line, ch: 0 }, end: { line, ch: 0 } } },
    })

    it("completes, reopens and reschedules the row's line in place", async () => {
        const { app, files } = makeFakeApp({ "a.md": "# Today\r\n    - [ ] call [[Bob]]\r\n- other\r\n" })
        await editTaskLine(app, task(1), { kind: "schedule", when: "weekend" }, MONDAY)
        expect(files.get("a.md")).toBe("# Today\r\n    - [ ] call [[Bob]] [scheduled:: 2026-10-10]\r\n- other\r\n")
        await editTaskLine(app, task(1), { kind: "done", done: true }, MONDAY)
        expect(files.get("a.md")).toBe("# Today\r\n    - [x] call [[Bob]] [scheduled:: 2026-10-10] [completion:: 2026-10-05]\r\n- other\r\n")
        await editTaskLine(app, task(1), { kind: "done", done: false }, MONDAY)
        expect(files.get("a.md")).toBe("# Today\r\n    - [ ] call [[Bob]] [scheduled:: 2026-10-10]\r\n- other\r\n")
    })

    it("throws StaleLineError, writing nothing, when the line no longer is that task", async () => {
        const { app, files } = makeFakeApp({ "a.md": "- [ ] call [[Alice]]\n- call [[Bob]]\n" })
        await expect(editTaskLine(app, task(0), { kind: "done", done: true }, MONDAY)).rejects.toBeInstanceOf(StaleLineError)
        await expect(editTaskLine(app, task(1), { kind: "done", done: true }, MONDAY)).rejects.toBeInstanceOf(StaleLineError)
        await expect(editTaskLine(app, task(5), { kind: "done", done: true }, MONDAY)).rejects.toBeInstanceOf(StaleLineError)
        expect(files.get("a.md")).toBe("- [ ] call [[Alice]]\n- call [[Bob]]\n")
    })

    it("completing cascades to the open subtasks; scheduling touches only the line", async () => {
        const content = "- [ ] p [[Bob]]\n    - [ ] sub\n- [ ] other\n"
        const done = makeFakeApp({ "a.md": content })
        await editTaskLine(done.app, task(0, "p [[bob]]"), { kind: "done", done: true }, MONDAY)
        expect(done.files.get("a.md")).toBe(
            "- [x] p [[Bob]] [completion:: 2026-10-05]\n    - [x] sub [completion:: 2026-10-05]\n- [ ] other\n",
        )
        const sched = makeFakeApp({ "a.md": content })
        await editTaskLine(sched.app, task(0, "p [[bob]]"), { kind: "schedule", when: "today" }, MONDAY)
        expect(sched.files.get("a.md")).toBe("- [ ] p [[Bob]] [scheduled:: 2026-10-05]\n    - [ ] sub\n- [ ] other\n")
    })
})

describe("reparent", () => {
    it("re-nests a bullet under the new parent in the same file", async () => {
        const { app, files } = makeFakeApp({ "2026-09-12.md": "- [[Old parent]]\n    - [[Child]]\n        - detail line\n" })

        const touched = await reparent(app, { kind: "same-file", sourcePath: "2026-09-12.md", line: 1, head: "    - [[Child]]", newName: "New parent" })

        expect(files.get("2026-09-12.md")).toBe("- [[Old parent]]\n- [[New parent]]\n    - [[Child]]\n        - detail line\n")
        expect(touched.map(f => f.path)).toEqual(["2026-09-12.md"])
    })

    it("moves a bullet from the old parent's note to the new parent's outline end", async () => {
        const { app, files } = makeFakeApp({
            "Old.md": "- [[Child]]\n    - note\n- [[Other]]\n",
            "New.md": "---\na: 1\n---\n- [[Existing]]\nprose\n",
        })

        const touched = await reparent(app, { kind: "cross-file", sourcePath: "Old.md", line: 0, head: "- [[Child]]", newName: "New" })

        expect(files.get("New.md")).toBe("---\na: 1\n---\n- [[Existing]]\n- [[Child]]\n    - note\nprose\n")
        expect(files.get("Old.md")).toBe("- [[Other]]\n")
        expect(touched.map(f => f.path)).toEqual(["New.md", "Old.md"])
    })

    it("keeps the copy and reports it when the source line changed before the cut", async () => {
        const { app, files } = makeFakeApp({
            "Old.md": "- [[Other]]\n- [[Child]]\n",
            "New.md": "",
        })
        // The first read sees the pre-change content; the cut inside vault.process sees the real one.
        app.vault.read = async () => "- [[Child]]\n- [[Other]]\n"

        await expect(reparent(app, { kind: "cross-file", sourcePath: "Old.md", line: 0, head: "- [[Child]]", newName: "New" }))
            .rejects.toThrow("Copied to [[New]] but the original line changed — remove it manually")
        expect(files.get("New.md")).toContain("- [[Child]]")
        expect(files.get("Old.md")).toBe("- [[Other]]\n- [[Child]]\n")
    })

    it("replaces a string frontmatter parent and keeps other keys", async () => {
        const { app, files } = makeFakeApp({ "Child.md": "---\nparent: \"[[Old]]\"\nother: keep\n---\nbody\n" })

        await reparent(app, { kind: "frontmatter", childPath: "Child.md", oldName: "old", newName: "New", relation: "parent" })

        const content = files.get("Child.md")!
        expect(yaml.load(content.split("---\n")[1])).toEqual({ parent: "[[New]]", other: "keep" })
        expect(content.endsWith("---\nbody\n")).toBe(true)
    })

    it("replaces only the matching entry of an array frontmatter parent", async () => {
        const { app, files } = makeFakeApp({ "Child.md": "---\nparent:\n  - \"[[A]]\"\n  - \"[[Old|alias]]\"\n---\n" })

        await reparent(app, { kind: "frontmatter", childPath: "Child.md", oldName: "Old", newName: "New", relation: "parent" })

        expect(yaml.load(files.get("Child.md")!.split("---\n")[1])).toEqual({ parent: ["[[A]]", "[[New]]"] })
    })

    it("throws StaleLineError when no frontmatter entry links the old parent", async () => {
        const { app } = makeFakeApp({ "Child.md": "---\nparent: \"[[Other]]\"\n---\n" })
        await expect(reparent(app, { kind: "frontmatter", childPath: "Child.md", oldName: "Old", newName: "New", relation: "parent" }))
            .rejects.toBeInstanceOf(StaleLineError)
    })
})

const fm = (content: string) => yaml.load(content.split("---\n")[1])

describe("appendUnderLine", () => {
    it("appendUnderLine nests the block under the line and reports where", async () => {
        const { app, files } = makeFakeApp({ "n.md": "- [ ] buy milk\n- other\n" })
        const out = await appendUnderLine(app, "n.md", 0, "- [ ] buy milk", ["- check price"])
        expect(files.get("n.md")).toBe("- [ ] buy milk\n    - check price\n- other\n")
        expect([out.file.path, out.line]).toEqual(["n.md", 1])
    })

    it("appendUnderLine throws StaleLineError for a missing file", async () => {
        const { app } = makeFakeApp()
        await expect(appendUnderLine(app, "gone.md", 0, "- a", ["- b"])).rejects.toBeInstanceOf(StaleLineError)
    })
})

describe("writeWholeNote", () => {
    it("replaces the note when it is unchanged", async () => {
        const { app, files } = makeFakeApp({ "P.md": "old\n" })
        await writeWholeNote(app, "P.md", "old\n", "new\n")
        expect(files.get("P.md")).toBe("new\n")
    })

    it("throws when the note changed since it was read", async () => {
        const { app, files } = makeFakeApp({ "P.md": "edited\n" })
        await expect(writeWholeNote(app, "P.md", "old\n", "new\n")).rejects.toThrow("Note changed since editing started — reopen the editor")
        expect(files.get("P.md")).toBe("edited\n")
    })

    it("creates the note and its folder for a null original", async () => {
        const { app, files, folders } = makeFakeApp()
        await writeWholeNote(app, "Notes/P.md", null, "text\n")
        expect(files.get("Notes/P.md")).toBe("text\n")
        expect(folders.has("Notes")).toBe(true)
    })

    it("throws for a null original when the note now exists", async () => {
        const { app } = makeFakeApp({ "P.md": "x\n" })
        await expect(writeWholeNote(app, "P.md", null, "new\n")).rejects.toThrow("Note changed since editing started")
    })
})

describe("reparent: set-parent / to-folder", () => {
    const base = { kind: "set-parent" as const, childName: "Child", relation: "parent", newName: "New", cfg }

    it("sets an absent relation", async () => {
        const { app, files } = makeFakeApp({ "Child.md": "body\n" })
        await reparent(app, { ...base, childPath: "Child.md", oldName: null })
        expect(fm(files.get("Child.md")!)).toEqual({ parent: "[[New]]" })
    })

    it("replaces a string relation", async () => {
        const { app, files } = makeFakeApp({ "Child.md": "---\nparent: \"[[Other]]\"\n---\n" })
        await reparent(app, { ...base, childPath: "Child.md", oldName: null })
        expect(fm(files.get("Child.md")!)).toEqual({ parent: "[[New]]" })
    })

    it("replaces the old parent's entry in an array", async () => {
        const { app, files } = makeFakeApp({ "Child.md": "---\nparent:\n  - \"[[A]]\"\n  - \"[[Old|x]]\"\n---\n" })
        await reparent(app, { ...base, childPath: "Child.md", oldName: "old" })
        expect(fm(files.get("Child.md")!)).toEqual({ parent: ["[[A]]", "[[New]]"] })
    })

    it("appends to an array without the old parent", async () => {
        const { app, files } = makeFakeApp({ "Child.md": "---\nparent:\n  - \"[[A]]\"\n---\n" })
        await reparent(app, { ...base, childPath: "Child.md", oldName: "Old" })
        expect(fm(files.get("Child.md")!)).toEqual({ parent: ["[[A]]", "[[New]]"] })
    })

    it("creates the note of a reference child", async () => {
        const { app, files } = makeFakeApp()
        const touched = await reparent(app, { ...base, childPath: null, oldName: null })
        expect(touched.map(f => f.path)).toEqual(["Child.md"])
        expect(fm(files.get("Child.md")!)).toEqual({ parent: "[[New]]" })
    })

    it("to-folder moves the file", async () => {
        const { app, files } = makeFakeApp({ "P.md": "x\n" })
        await reparent(app, { kind: "to-folder", childPath: "P.md", folderPath: "Projects" })
        expect(files.get("Projects/P.md")).toBe("x\n")
        expect(files.has("P.md")).toBe(false)
    })

    it("to-folder throws when the name is taken", async () => {
        const { app, files } = makeFakeApp({ "P.md": "x\n", "Projects/P.md": "y\n" })
        await expect(reparent(app, { kind: "to-folder", childPath: "P.md", folderPath: "Projects" })).rejects.toThrow("P.md already exists in Projects")
        expect(files.get("P.md")).toBe("x\n")
    })
})

describe("reparent: to-daily / under-line", () => {
    const daily = dailyNotePath(cfg)
    const toDaily = { kind: "to-daily" as const, line: 0, head: "- [[Bob]] call", parentLink: "P#H", cfg }

    it("to-daily moves within today's note without stamping", async () => {
        const { app, files } = makeFakeApp({ [daily]: "- [[Bob]] call\n    - prose\n- [[P#H]]\n    - x\n" })
        const touched = await reparent(app, { ...toDaily, sourcePath: daily, stampDate: "2026-01-01" })
        expect(files.get(daily)).toBe("- [[P#H]]\n    - x\n    - [[Bob]] call\n        - prose\n")
        expect(touched.map(f => f.path)).toEqual([daily])
    })

    it("to-daily from another note stamps only its indexed lines", async () => {
        const { app, files } = makeFakeApp({ "Old.md": "- [[Bob]] call\n    - prose\n    - [ ] t\n- keep\n" })
        const touched = await reparent(app, { ...toDaily, sourcePath: "Old.md", stampDate: "2026-01-01" })
        expect(files.get(daily)).toBe("- [[P#H]]\n    - [[Bob]] call [created:: 2026-01-01]\n        - prose\n        - [ ] t [created:: 2026-01-01]\n")
        expect(files.get("Old.md")).toBe("- keep\n")
        expect(touched.map(f => f.path)).toEqual([daily, "Old.md"])
    })

    it("to-daily keeps the copy and reports a failed cut", async () => {
        const { app, files } = makeFakeApp({ "Old.md": "- other\n- [[Bob]] call\n" })
        app.vault.read = async () => "- [[Bob]] call\n- other\n"
        await expect(reparent(app, { ...toDaily, sourcePath: "Old.md", stampDate: null }))
            .rejects.toThrow("Copied to today's daily note but the original line changed — remove it manually")
        expect(files.get(daily)).toContain("- [[Bob]] call")
        expect(files.get("Old.md")).toBe("- other\n- [[Bob]] call\n")
    })

    const underLine = { kind: "under-line" as const, stampDate: null }

    it("under-line in the same file shifts a target after the cut", async () => {
        const { app, files } = makeFakeApp({ "n.md": "- a\n    - a1\n- b\n" })
        await reparent(app, { ...underLine, sourcePath: "n.md", line: 0, head: "- a", targetPath: "n.md", targetLine: 2, targetHead: "- b" })
        expect(files.get("n.md")).toBe("- b\n    - a\n        - a1\n")
    })

    it("under-line refuses a target inside the moved subtree", async () => {
        const { app, files } = makeFakeApp({ "n.md": "- a\n    - a1\n- b\n" })
        await expect(reparent(app, { ...underLine, sourcePath: "n.md", line: 0, head: "- a", targetPath: "n.md", targetLine: 1, targetHead: "    - a1" }))
            .rejects.toThrow("Can't move a line under itself")
        expect(files.get("n.md")).toBe("- a\n    - a1\n- b\n")
    })

    it("under-line across files pastes stamped under the target, then cuts", async () => {
        const { app, files } = makeFakeApp({ "Old.md": "- [[X]] y\n- keep\n", "T.md": "- [ ] target\n" })
        const touched = await reparent(app, { kind: "under-line", sourcePath: "Old.md", line: 0, head: "- [[X]] y", targetPath: "T.md", targetLine: 0, targetHead: "- [ ] target", stampDate: "2026-01-01" })
        expect(files.get("T.md")).toBe("- [ ] target\n    - [[X]] y [created:: 2026-01-01]\n")
        expect(files.get("Old.md")).toBe("- keep\n")
        expect(touched.map(f => f.path)).toEqual(["T.md", "Old.md"])
    })
})

describe("renameVaultFile", () => {
    it("renames in the file's folder, keeping its extension", async () => {
        const { app, files } = makeFakeApp({ "assets/photo.png": "img" })
        expect(await renameVaultFile(app, "assets/photo.png", " cover ")).toBe("assets/cover.png")
        expect([...files.keys()]).toEqual(["assets/cover.png"])
    })

    it("refuses an existing name and a missing file", async () => {
        const { app } = makeFakeApp({ "photo.png": "a", "cover.png": "b" })
        await expect(renameVaultFile(app, "photo.png", "cover")).rejects.toThrow('"cover.png" already exists')
        await expect(renameVaultFile(app, "gone.png", "x")).rejects.toBeInstanceOf(StaleLineError)
    })
})
