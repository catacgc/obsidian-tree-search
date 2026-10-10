// Link pastes (EDITOR.md §3.8) shared by the inline editor's fields and the search input's append chain.
// Uses the DOM (DOMParser), so it stays out of the pure textarea-ops.
import {pasteLink, pastedUrl, type PasteData, type TextEdit} from "./textarea-ops"

/** Text of the clipboard HTML's only `<a>` whose href is `url` (ignoring one trailing "/"), else "". */
function clipboardLinkTitle(html: string, url: string): string {
    const anchors = new DOMParser().parseFromString(html, "text/html").querySelectorAll("a[href]")
    if (anchors.length !== 1) return ""
    const strip = (s: string) => s.trim().replace(/\/$/, "")
    if (strip(anchors[0].getAttribute("href")!) !== strip(url)) return ""
    const t = (anchors[0].textContent ?? "").replace(/\s+/g, " ").trim()
    return t === "" || strip(t) === strip(url) ? "" : t
}

/** A paste of a single URL over [start, end) of `text` as a markdown link (`pasteLink`, titled from the clipboard
 *  HTML); null when the paste isn't a URL or the spot takes no link, so the caller pastes normally. */
export function linkPasteEdit(text: string, start: number, end: number, data: Pick<PasteData, "plain" | "html">): TextEdit | null {
    const url = pastedUrl(data.plain)
    if (url === null) return null
    return pasteLink(text, start, end, url, data.html === "" ? "" : clipboardLinkTitle(data.html, url))
}
