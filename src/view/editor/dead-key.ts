// macOS Option+letter shortcuts on dead keys (Option+N, E, U, I, `) start an IME
// composition (`˜`, `´`, `¨`, …) that keydown `preventDefault` can't stop. It lands in
// whichever text field has focus when it arrives, often one the shortcut just focused.

const WINDOW_MS = 1000

/**
 * Call from the keydown handler of a shortcut that handled `ev`. On a dead key, the
 * composition that follows within a second is ended (blur) and its field restored to the
 * value and selection it had before the composition started. No-op for other keys.
 */
export function swallowDeadKey(ev: {key: string}): void {
    if (ev.key !== "Dead") return
    let before: {el: HTMLInputElement | HTMLTextAreaElement; value: string; start: number; end: number} | null = null

    const onStart = (e: Event) => {
        const el = e.target
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return
        before = {el, value: el.value, start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length}
    }
    const onInput = (e: Event) => {
        const b = before
        if (!b || e.target !== b.el) return
        stop()
        // Leave the event dispatch before touching the field.
        window.setTimeout(() => restore(b.el, b.value, b.start, b.end))
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

function restore(el: HTMLInputElement | HTMLTextAreaElement, value: string, start: number, end: number) {
    const focused = document.activeElement === el
    // Blurring ends the composition (and the OS dead-key state) before the value is reset.
    if (focused) el.blur()
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value)
    // React-controlled fields pick the value up from a bubbling `input` event.
    el.dispatchEvent(new Event("input", {bubbles: true}))
    if (!focused) return
    el.focus()
    try { el.setSelectionRange(start, end) } catch { /* type=search may reject it */ }
}
