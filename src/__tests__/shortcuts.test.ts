import { describe, it, expect } from "bun:test"
import { isAvailable, matchShortcut, SHORTCUTS } from "../view/search/shortcuts"

const ev = (code: string, mods: { alt?: boolean; ctrl?: boolean; shift?: boolean; meta?: boolean } = {}) => ({
    code, altKey: !!mods.alt, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, metaKey: !!mods.meta,
})
const idOf = (e: ReturnType<typeof ev>, list = SHORTCUTS, isMac = true) => matchShortcut(e, list, isMac)?.shortcut.id ?? null

describe("matchShortcut", () => {
    it("keeps Enter, Shift+Enter and Alt+Enter apart by exact modifiers", () => {
        expect(idOf(ev("Enter"))).toBe("open")
        expect(idOf(ev("NumpadEnter", { shift: true }))).toBe("reveal")
        expect(idOf(ev("Enter", { alt: true }))).toBe("edit")
        expect(idOf(ev("Enter", { alt: true, shift: true }))).toBeNull()
    })

    it("ignores Cmd/Meta combos and plain letters typed into the query", () => {
        expect(idOf(ev("KeyC", { meta: true, ctrl: true }))).toBeNull()
        expect(idOf(ev("KeyC", { meta: true }))).toBeNull()
        expect(idOf(ev("KeyT"))).toBeNull()
    })

    it("opens the action panel with ⌘K on macOS and Ctrl+K elsewhere", () => {
        expect(idOf(ev("KeyK", { meta: true }), SHORTCUTS, true)).toBe("actions")
        expect(idOf(ev("KeyK", { ctrl: true }), SHORTCUTS, true)).toBeNull()
        expect(idOf(ev("KeyK", { ctrl: true }), SHORTCUTS, false)).toBe("actions")
        expect(idOf(ev("KeyK", { meta: true }), SHORTCUTS, false)).toBeNull()
    })

    it("keeps Ctrl shortcuts on Ctrl on every platform", () => {
        expect(idOf(ev("KeyC", { ctrl: true }), SHORTCUTS, true)).toBe("copy")
        expect(idOf(ev("KeyC", { ctrl: true }), SHORTCUTS, false)).toBe("copy")
    })

    it("reports which recency key was pressed", () => {
        expect(matchShortcut(ev("Digit3", { alt: true }), SHORTCUTS, true)).toMatchObject({ shortcut: { id: "recency" }, index: 2 })
    })
})

describe("isAvailable", () => {
    it("drops editor and timeline shortcuts from views without them", () => {
        const plain = SHORTCUTS.filter(s => isAvailable(s, { allowEditing: false, allowTimeline: false }))
        expect(idOf(ev("KeyA", { alt: true }), plain)).toBeNull()
        expect(idOf(ev("KeyT", { alt: true }), plain)).toBeNull()
        expect(idOf(ev("KeyI", { alt: true }), plain)).toBe("insertAfter")
    })
})
