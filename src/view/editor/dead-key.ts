// macOS Option+letter shortcuts on dead keys (Option+N, E, U, I, `) start an IME
// composition (`˜`, `´`, `¨`, …) that keydown `preventDefault` can't stop. It lands in
// whichever text field has focus when it arrives, often one the shortcut just focused
// (e.g. the inline editor's CodeMirror outline after Alt+N).
import {EditorView} from "@codemirror/view";

const WINDOW_MS = 1000

type TextControl = HTMLInputElement | HTMLTextAreaElement
type Snapshot =
    | {el: TextControl; value: string; start: number; end: number}
    | {view: EditorView; value: string; start: number; end: number}

const isTextControl = (el: EventTarget | null): el is TextControl =>
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement

/**
 * Call from the keydown handler of a shortcut that handled `ev`. On a dead key, the
 * composition that follows within a second is ended (blur) and its field restored to the
 * value and selection it had before the composition started. No-op for other keys.
 */
export function swallowDeadKey(ev: {key: string}): void {
    if (ev.key !== "Dead") return
    let before: Snapshot | null = null

    const onStart = (e: Event) => {
        const el = e.target
        if (isTextControl(el)) {
            before = {el, value: el.value, start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length}
            return
        }
        const view = el instanceof HTMLElement ? EditorView.findFromDOM(el) : null
        if (view) {
            const sel = view.state.selection.main
            before = {view, value: view.state.doc.toString(), start: sel.from, end: sel.to}
        }
    }
    const onInput = (e: Event) => {
        const b = before
        if (!b || e.target !== ("el" in b ? b.el : b.view.contentDOM)) return
        stop()
        // Leave the event dispatch before touching the field.
        window.setTimeout(() => restore(b))
    }
    const stop = () => {
        document.removeEventListener("compositionstart", onStart, true)
        document.removeEventListener("input", onInput, true)
        window.clearTimeout(timer)
    }
    document.addEventListener("compositionstart", onStart, true)
    document.addEventListener("input", onInput, true)
    const timer = window.setTimeout(stop, WINDOW_MS)
}

function restore(b: Snapshot) {
    const {value, start, end} = b
    if (!("el" in b)) {
        // The editor's update listener feeds the owner; no synthetic input event.
        const {view} = b
        const focused = view.hasFocus
        // Blurring ends the composition (and the OS dead-key state) before the doc is reset.
        if (focused) view.contentDOM.blur()
        view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: value}, selection: {anchor: start, head: end}})
        if (focused) view.focus()
        return
    }
    const {el} = b
    const focused = document.activeElement === el
    if (focused) el.blur()
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value)
    // React-controlled fields pick the value up from a bubbling `input` event.
    el.dispatchEvent(new Event("input", {bubbles: true}))
    if (!focused) return
    el.focus()
    try { el.setSelectionRange(start, end) } catch { /* type=search may reject it */ }
}
