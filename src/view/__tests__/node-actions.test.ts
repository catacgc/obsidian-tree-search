import { describe, it, expect } from "bun:test"
import { prioritizeWebLinks, RaycastAction, getTreeNodeActions } from "../node-actions"

const browse = (url: string, title: string, shortcut?: RaycastAction["shortcut"]): RaycastAction => ({
    type: "browse",
    url,
    title,
    icon: "globe-01-16",
    ...(shortcut ? { shortcut } : {}),
})

const copy = (text: string): RaycastAction => ({
    type: "copy",
    text,
    title: `Copy "${text}"`,
    icon: "copy-clipboard-16",
})

describe("prioritizeWebLinks", () => {
    it("moves web links before obsidian links", () => {
        const actions: RaycastAction[] = [
            browse("obsidian://tree-search-uri?open&filepath=Person", "Open Person"),
            browse("obsidian://tree-search-uri?open&filepath=Project", "Open Project"),
            browse("https://example.com", "Browse example.com"),
        ]
        const result = prioritizeWebLinks(actions)
        expect(result[0].title).toBe("Browse example.com")
        expect(result[1].title).toBe("Open Person")
        expect(result[2].title).toBe("Open Project")
    })

    it("assigns enter shortcut to first web link when no action has enter", () => {
        const actions: RaycastAction[] = [
            browse("obsidian://tree-search-uri?open&filepath=Note", "Open Note"),
            browse("https://example.com", "Browse example.com"),
        ]
        const result = prioritizeWebLinks(actions)
        expect(result[0].shortcut).toEqual({ key: "enter", modifiers: [] })
    })

    it("does not assign enter shortcut when one already exists", () => {
        const actions: RaycastAction[] = [
            browse("obsidian://tree-search-uri?open&filepath=Page", "Open Page", { key: "enter", modifiers: [] }),
            browse("https://example.com", "Browse example.com"),
        ]
        const result = prioritizeWebLinks(actions)
        expect(result[0].title).toBe("Browse example.com")
        expect(result[0].shortcut).toBeUndefined()
        expect(result[1].shortcut).toEqual({ key: "enter", modifiers: [] })
    })

    it("returns actions unchanged when there are no web links", () => {
        const actions: RaycastAction[] = [
            browse("obsidian://tree-search-uri?open&filepath=A", "Open A"),
            browse("obsidian://tree-search-uri?open&filepath=B", "Open B"),
        ]
        const result = prioritizeWebLinks(actions)
        expect(result).toEqual(actions)
    })

    it("preserves non-browse actions in original order after web links", () => {
        const actions: RaycastAction[] = [
            copy("some code"),
            browse("obsidian://tree-search-uri?open&filepath=Note", "Open Note"),
            browse("https://github.com/repo", "Browse GitHub"),
        ]
        const result = prioritizeWebLinks(actions)
        expect(result[0].title).toBe("Browse GitHub")
        expect(result[1].title).toBe('Copy "some code"')
        expect(result[2].title).toBe("Open Note")
    })

    it("handles multiple web links preserving their relative order", () => {
        const actions: RaycastAction[] = [
            browse("obsidian://tree-search-uri?open&filepath=Ref", "Open Ref"),
            browse("https://first.com", "Browse first"),
            browse("https://second.com", "Browse second"),
        ]
        const result = prioritizeWebLinks(actions)
        expect(result[0].title).toBe("Browse first")
        expect(result[1].title).toBe("Browse second")
        expect(result[2].title).toBe("Open Ref")
    })

    it("returns empty array unchanged", () => {
        expect(prioritizeWebLinks([])).toEqual([])
    })
})

describe("archive/unarchive actions", () => {
    const mockApp = { vault: { getName: () => "TestVault", getFileByPath: () => null } } as any

    function createTreeNode(parsedTokens: any[]): any {
        return {
            node: {
                nodeType: "text",
                searchKey: "test",
                location: {
                    path: "test.md",
                    position: { start: { line: 1, ch: 0 }, end: { line: 1, ch: 10 } }
                },
                boost: 0,
                ageDays: 1,
                parsedTokens,
                tags: [],
                isTask: false,
                isCompleted: false
            },
            indent: 0,
            hasChildren: false,
            visible: true,
            selected: false,
            index: 0
        }
    }

    it("shows Archive action for non-archived text node", () => {
        const treeNode = createTreeNode([{ tokenType: "text", text: "Normal text" }])
        const actions = getTreeNodeActions(mockApp, treeNode)

        const archiveAction = actions.find(a => a.title === "Archive")
        expect(archiveAction).toBeDefined()
        expect(archiveAction?.icon).toBe("bookmark-16")
    })

    it("shows Unarchive action for archived text node", () => {
        const treeNode = createTreeNode([
            { tokenType: "meta_mdtree", directive: "archive" }
        ])
        const actions = getTreeNodeActions(mockApp, treeNode)

        const unarchiveAction = actions.find(a => a.title === "Unarchive")
        expect(unarchiveAction).toBeDefined()
        expect(unarchiveAction?.icon).toBe("bookmark-16")
    })

    it("archive action URL contains raycastaction=archive", () => {
        const treeNode = createTreeNode([{ tokenType: "text", text: "Normal text" }])
        const actions = getTreeNodeActions(mockApp, treeNode)

        const archiveAction = actions.find(a => a.title === "Archive")
        expect(archiveAction?.type).toBe("browse")
        if (archiveAction?.type === "browse") {
            expect(archiveAction.url).toContain("raycastaction=archive")
            expect(archiveAction.url).toContain("vault=TestVault")
            expect(archiveAction.url).toContain("filepath=test.md")
            expect(archiveAction.url).toContain("sl=1")
            expect(archiveAction.url).toContain("sc=0")
            expect(archiveAction.url).toContain("el=1")
            expect(archiveAction.url).toContain("ec=10")
        }
    })

    it("unarchive action URL contains raycastaction=unarchive", () => {
        const treeNode = createTreeNode([
            { tokenType: "meta_mdtree", directive: "archive" }
        ])
        const actions = getTreeNodeActions(mockApp, treeNode)

        const unarchiveAction = actions.find(a => a.title === "Unarchive")
        expect(unarchiveAction?.type).toBe("browse")
        if (unarchiveAction?.type === "browse") {
            expect(unarchiveAction.url).toContain("raycastaction=unarchive")
            expect(unarchiveAction.url).toContain("vault=TestVault")
            expect(unarchiveAction.url).toContain("filepath=test.md")
        }
    })
})

describe("archive/unarchive actions for pages", () => {
    // Resolves a link by basename to `<name>.md` in the vault root, like Obsidian's shortest-path links.
    const notes = new Set(["Page Name.md", "Child.md"])
    const mockApp = {
        vault: { getName: () => "TestVault", getFileByPath: () => null },
        metadataCache: { getFirstLinkpathDest: (name: string) => notes.has(`${name}.md`) ? { path: `${name}.md` } : null },
    } as any

    function createPageTreeNode(archived: boolean): any {
        return {
            node: {
                nodeType: "page",
                page: "Page Name",
                isReference: false,
                aliases: [],
                tags: [],
                searchKey: "page name|",
                location: {
                    path: "Page Name.md",
                    position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } }
                },
                boost: 0,
                ageDays: 1,
                ...(archived ? { archived: true } : {})
            },
            indent: 0,
            hasChildren: false,
            visible: true,
            selected: false,
            index: 0
        }
    }

    it("shows Archive action for non-archived page node", () => {
        const actions = getTreeNodeActions(mockApp, createPageTreeNode(false))

        const archiveAction = actions.find(a => a.title === "Archive")
        expect(archiveAction).toBeDefined()
        expect(archiveAction?.icon).toBe("bookmark-16")
    })

    it("shows Unarchive action for archived page node", () => {
        const actions = getTreeNodeActions(mockApp, createPageTreeNode(true))

        const unarchiveAction = actions.find(a => a.title === "Unarchive")
        expect(unarchiveAction).toBeDefined()
        expect(unarchiveAction?.icon).toBe("bookmark-16")
    })

    it("archive action URL contains raycastaction=archivePage with no line/col params", () => {
        const actions = getTreeNodeActions(mockApp, createPageTreeNode(false))

        const archiveAction = actions.find(a => a.title === "Archive")
        expect(archiveAction?.type).toBe("browse")
        if (archiveAction?.type === "browse") {
            expect(archiveAction.url).toContain("raycastaction=archivePage")
            expect(archiveAction.url).toContain("vault=TestVault")
            expect(archiveAction.url).toContain("filepath=Page")
            expect(archiveAction.url).not.toContain("sl=")
            expect(archiveAction.url).not.toContain("sc=")
            expect(archiveAction.url).not.toContain("el=")
            expect(archiveAction.url).not.toContain("ec=")
        }
    })

    it("unarchive action URL contains raycastaction=unarchivePage", () => {
        const actions = getTreeNodeActions(mockApp, createPageTreeNode(true))

        const unarchiveAction = actions.find(a => a.title === "Unarchive")
        expect(unarchiveAction?.type).toBe("browse")
        if (unarchiveAction?.type === "browse") {
            expect(unarchiveAction.url).toContain("raycastaction=unarchivePage")
            expect(unarchiveAction.url).toContain("vault=TestVault")
            expect(unarchiveAction.url).toContain("filepath=Page")
        }
    })

    // A page shown as a child carries the location of the link that relates it, here a line
    // in its parent's note; page actions must still act on the page's own note.
    function childPageTreeNode(page: string, archived = false): any {
        const node = createPageTreeNode(archived)
        node.node = { ...node.node, page, searchKey: `${page.toLowerCase()}|`,
            location: { path: "Folder/Parent.md", position: { start: { line: 3, ch: 0 }, end: { line: 3, ch: 11 } } } }
        node.indent = 1
        return node
    }

    it("archives and moves a child page's own note, not the parent note holding its link", () => {
        const actions = getTreeNodeActions(mockApp, childPageTreeNode("Child"))
        const archive = actions.find(a => a.title === "Archive")
        const move = actions.find(a => a.title === "Move To")
        expect(archive?.type === "browse" && new URL(archive.url).searchParams.get("filepath")).toBe("Child.md")
        expect(archive?.type === "browse" && archive.location?.path).toBe("Child.md")
        expect(move?.type === "browse" && new URL(move.url).searchParams.get("filepath")).toBe("Child.md")
    })

    it("unarchives a child page's own note", () => {
        const unarchive = getTreeNodeActions(mockApp, childPageTreeNode("Child", true)).find(a => a.title === "Unarchive")
        expect(unarchive?.type === "browse" && unarchive.location?.path).toBe("Child.md")
    })

    it("offers no Archive or Move To for a page without a note", () => {
        const titles = getTreeNodeActions(mockApp, childPageTreeNode("Missing")).map(a => a.title)
        expect(titles).not.toContain("Archive")
        expect(titles).not.toContain("Move To")
    })

    it("consolidates a child page into its own note, not the note that is open or holds its link", () => {
        const consolidate = getTreeNodeActions(mockApp, childPageTreeNode("Child")).find(a => a.title === "Consolidate notes")
        expect(consolidate?.type === "browse" && new URL(consolidate.url).searchParams.get("filepath")).toBe("Child.md")
    })

    it("offers no Consolidate notes for a page without a note", () => {
        const titles = getTreeNodeActions(mockApp, childPageTreeNode("Missing")).map(a => a.title)
        expect(titles).not.toContain("Consolidate notes")
    })
})

describe("insert-link (quick-link) actions", () => {
    const mockApp = {
        vault: { getName: () => "TestVault", getFileByPath: () => null },
        metadataCache: { getFirstLinkpathDest: (name: string) => ({ path: `${name}.md` }) },
    } as any

    const location = {
        path: "test.md",
        position: { start: { line: 1, ch: 0 }, end: { line: 1, ch: 10 } }
    }

    function createPageNode(): any {
        return {
            node: {
                nodeType: "page", page: "Page Name", isReference: false,
                aliases: [], tags: [], searchKey: "page name|", location, boost: 0, ageDays: 1
            },
            indent: 0, hasChildren: false, visible: true, selected: false, index: 0
        }
    }

    function createHeaderNode(): any {
        return {
            node: {
                nodeType: "header", page: "Page Name", header: "Header", indent: 2,
                searchKey: "page name#header", location, boost: 0, ageDays: 1
            },
            indent: 0, hasChildren: false, visible: true, selected: false, index: 0
        }
    }

    it("makes insert-link the first, default (plain Enter) action for a page", () => {
        const actions = getTreeNodeActions(mockApp, createPageNode(), "insertLink")
        const first = actions[0]
        expect(first.type).toBe("insertLink")
        if (first.type === "insertLink") expect(first.text).toBe("[[Page Name]]")
        expect(first.shortcut).toEqual({ modifiers: [], key: "enter" })
    })

    it("builds [[Page#Header]] for a header node", () => {
        const actions = getTreeNodeActions(mockApp, createHeaderNode(), "insertLink")
        const insert = actions.find(a => a.type === "insertLink")
        expect(insert?.type).toBe("insertLink")
        if (insert?.type === "insertLink") expect(insert.text).toBe("[[Page Name#Header]]")
    })

    it("leaves exactly one plain-Enter action but keeps Shift+Enter", () => {
        const actions = getTreeNodeActions(mockApp, createPageNode(), "insertLink")
        const plainEnter = actions.filter(a => a.shortcut?.key === "enter" && a.shortcut.modifiers.length === 0)
        expect(plainEnter.length).toBe(1)
        expect(plainEnter[0].type).toBe("insertLink")
        expect(actions.some(a => a.shortcut?.key === "enter" && a.shortcut.modifiers.includes("shift"))).toBe(true)
    })

    it("does not add an insert-link action outside quick-link mode", () => {
        const actions = getTreeNodeActions(mockApp, createPageNode())
        expect(actions.some(a => a.type === "insertLink")).toBe(false)
    })
})
