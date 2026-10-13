// Keyboard shortcuts of the search views (pane and modal). One table drives both
// KeyComboWrapper's dispatch and the Shortcuts section of SearchHelp, so the help
// can't drift from the behavior. Alt shortcuts are matched by physical key (`code`):
// on macOS Option+letter types a character, and Option+N / Option+I are dead keys.

export type KeySpec = {
    /** `KeyboardEvent.code` values that trigger the key. */
    code: string[]
    label: string
    macLabel?: string
    alt?: boolean
    ctrl?: boolean
    shift?: boolean
    /** Display only: ⌘ on macOS, Ctrl elsewhere. */
    mod?: boolean
}

export type ShortcutId =
    | "next" | "previous" | "open" | "reveal" | "actions"
    | "toggleView" | "recency" | "expand" | "collapse" | "collapseAll" | "refresh"
    | "copy" | "insertAfter" | "moveUnder" | "cut" | "archive" | "consolidate"
    | "append" | "edit" | "quickAdd"

export type Shortcut = {
    id: ShortcutId
    group: string
    keys: KeySpec[]
    description: string
    /** Only offered in views with editor mode / a Tree–Timeline toggle. */
    needs?: "editing" | "timeline"
}

const ENTER = ["Enter", "NumpadEnter"]
const key = (code: string | string[], label: string, mods: Partial<KeySpec> = {}): KeySpec =>
    ({code: Array.isArray(code) ? code : [code], label, ...mods})
const alt = (code: string, label: string) => key(code, label, {alt: true})

export const SHORTCUTS: Shortcut[] = [
    {id: "next", group: "Results", keys: [key("ArrowDown", "↓")], description: "Select next"},
    {id: "previous", group: "Results", keys: [key("ArrowUp", "↑")], description: "Select previous"},
    {id: "open", group: "Results", keys: [key(ENTER, "Enter", {macLabel: "↵"})], description: "Open (default action)"},
    {id: "reveal", group: "Results", keys: [key(ENTER, "Enter", {macLabel: "↵", shift: true})], description: "See in Obsidian"},
    {id: "actions", group: "Results", keys: [key("KeyK", "K", {mod: true})], description: "Actions"},

    {id: "toggleView", group: "View", keys: [alt("KeyT", "T")], description: "Switch tree / timeline", needs: "timeline"},
    {
        id: "recency", group: "View", needs: "timeline",
        keys: [alt("Digit1", "1"), alt("Digit2", "2"), alt("Digit3", "3"), alt("Digit4", "4")],
        description: "Recency: all / 7d / 30d / 1y",
    },
    {id: "expand", group: "View", keys: [alt("Equal", "=")], description: "Tree: expand one level"},
    {id: "collapse", group: "View", keys: [alt("Minus", "-")], description: "Tree: collapse one level"},
    {id: "collapseAll", group: "View", keys: [alt("Digit0", "0")], description: "Tree: collapse all"},
    {id: "refresh", group: "View", keys: [alt("KeyR", "R")], description: "Rebuild the index"},

    {id: "copy", group: "Selected row", keys: [key("KeyC", "C", {ctrl: true})], description: "Copy as a link"},
    {id: "insertAfter", group: "Selected row", keys: [alt("KeyI", "I"), key("KeyI", "I", {ctrl: true})], description: "Insert after"},
    {id: "moveUnder", group: "Selected row", keys: [alt("KeyM", "M")], description: "Move under… (search for the new parent)"},
    {id: "cut", group: "Selected row", keys: [key("KeyX", "X", {mod: true})], description: "Cut to the drawer (again: take it out)", needs: "editing"},
    {id: "archive", group: "Selected row", keys: [alt("KeyX", "X")], description: "Archive / unarchive"},
    {id: "consolidate", group: "Selected row", keys: [alt("KeyP", "P")], description: "Consolidate notes (pages)"},

    {id: "append", group: "Editor", keys: [alt("KeyA", "A")], description: "Append to the row's note", needs: "editing"},
    {id: "edit", group: "Editor", keys: [key(ENTER, "Enter", {macLabel: "↵", alt: true})], description: "Edit the row (Rename a heading or attachment)", needs: "editing"},
    {id: "quickAdd", group: "Editor", keys: [alt("KeyN", "N")], description: "Quick Add: search to patch, or type to add to today", needs: "editing"},
]

/** Keys inside the inline editor's text fields (handled by InlineEditor; listed for help only). */
export const EDITOR_KEYS: {keys: KeySpec[]; description: string}[] = [
    {keys: [key(ENTER, "Enter", {macLabel: "↵", shift: true}), key(ENTER, "Enter", {macLabel: "↵", mod: true})], description: "Save"},
    {keys: [key("Escape", "Esc")], description: "Cancel"},
    {keys: [key("Tab", "Tab", {macLabel: "⇥"}), key("Tab", "Tab", {macLabel: "⇥", shift: true})], description: "Indent / outdent"},
    {keys: [key(ENTER, "Enter", {macLabel: "↵", alt: true})], description: "Content of the link on the line, else the whole note"},
    {keys: [key("KeyB", "B", {mod: true}), key("KeyI", "I", {mod: true}), key("KeyK", "K", {mod: true})], description: "Bold / italic / link"},
]

export function isAvailable(s: Shortcut, view: {allowEditing: boolean; allowTimeline: boolean}): boolean {
    if (s.needs === "editing") return view.allowEditing
    if (s.needs === "timeline") return view.allowTimeline
    return true
}

type KeyEventLike = {code: string; altKey: boolean; ctrlKey: boolean; shiftKey: boolean; metaKey: boolean}

/** The shortcut (and which of its keys) `ev` triggers; modifiers must match exactly, so Enter, Shift+Enter and Alt+Enter stay distinct.
 *  `mod` is ⌘ on macOS and Ctrl elsewhere; ⌘ never matches a key that doesn't ask for it. */
export function matchShortcut(ev: KeyEventLike, shortcuts: Shortcut[], isMac: boolean): {shortcut: Shortcut; index: number} | null {
    const modsMatch = (k: KeySpec) => isMac
        ? !!k.mod === ev.metaKey && !!k.ctrl === ev.ctrlKey
        : !!(k.mod || k.ctrl) === ev.ctrlKey && !ev.metaKey
    for (const shortcut of shortcuts) {
        const index = shortcut.keys.findIndex(k =>
            k.code.includes(ev.code) && !!k.alt === ev.altKey && !!k.shift === ev.shiftKey && modsMatch(k))
        if (index >= 0) return {shortcut, index}
    }
    return null
}

/** A key's modifiers and key as separate keycaps: `["⇧", "↵"]` on macOS, `["Shift", "Enter"]` elsewhere. */
export function keyParts(k: KeySpec, isMac: boolean): string[] {
    if (isMac) return [k.ctrl && "⌃", k.alt && "⌥", k.shift && "⇧", k.mod && "⌘", k.macLabel ?? k.label].filter((p): p is string => !!p)
    return [(k.ctrl || k.mod) && "Ctrl", k.alt && "Alt", k.shift && "Shift", k.label].filter((p): p is string => !!p)
}

export function formatKey(k: KeySpec, isMac: boolean): string {
    return keyParts(k, isMac).join(isMac ? "" : "+")
}
