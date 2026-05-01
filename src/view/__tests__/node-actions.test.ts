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
