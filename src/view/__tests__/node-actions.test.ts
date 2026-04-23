import { describe, it, expect } from "bun:test"
import { prioritizeWebLinks, RaycastAction } from "../node-actions"

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
