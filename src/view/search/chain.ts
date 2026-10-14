// Search chains, pure. Two modes share the chips in the search input:
// - append (`>`): the chips are an anchor row (or today) and typed entries (`[[note]]`, `|alias`, `#heading`,
//   `(key:: value)`, `- item`). The chain builds Outline-editor text (`chainOutline`); Enter writes it through the
//   editor's own append Save, Alt+Enter opens the editor on it.
// - reparent (`<`, Move under): one chip, the moved rows (one row, or the cut drawer's); the planning below decides
//   where each goes.
// No obsidian value imports; the atoms in state.tsx / EditorMolecule.ts run the plans.
import {
    advancedSearch,
    extractArchiveReveal,
    getKey,
    linkTargetTree,
    openLinkAt,
    parseLinkBullet,
    parseQuery,
    partitionArchived,
    pruneResultTree,
    renderLinkBullet,
    renderOutline,
    searchIndex,
    type LinkBullet,
    type NotesGraph,
    type OutlineLine,
    type ParsedNode,
    type QueryExpr,
    type ResultNode,
    type SearchOptions,
} from "@mdtree/core"
import type {ReparentPlan} from "../../editing/vault-edits"
import type {DailyNoteConfig} from "../../indexing/indexed-tree"
import type {OwnPath} from "../editor/row-editing"
import type {UnderLine} from "../editor/EditorMolecule"
import {nodeLabel} from "./timeline-utils"

/** A result row a chip stands for: its node (with the row's location) and the node of its tree parent row (Tree mode). */
export type RowRef = {node: ParsedNode; label: string; parent: ParsedNode | null}

export type ChainAnchor =
    | {kind: "today"}
    /** A page row (or a reference), or a closed `[[name]]` query. */
    | {kind: "note"; name: string}
    | {kind: "header"; page: string; header: string}
    /** A text row; `target` is read from the file when the chip is pushed. */
    | {kind: "line"; node: ParsedNode; target: UnderLine}

export type ChainEntry =
    /** `[[N]]`, `[[N#H]]`, `[[N|A]]`, `[[N]] (k:: v)` */
    | {kind: "note"; link: LinkBullet}
    /** `#text` or `# text` */
    | {kind: "heading"; text: string}
    /** `|alias` */
    | {kind: "alias"; alias: string}
    /** `(key:: value)` or `key:: value` */
    | {kind: "field"; key: string; value: string}
    | {kind: "item"; marker: "- " | "- [ ] " | "- [x] "; text: string}

export type ChainStep =
    | {kind: "row"; anchor: ChainAnchor; label: string; prevQuery: string}
    | {kind: "entry"; entry: ChainEntry; label: string; prevQuery: string}

/** Row steps never follow entry steps. `quickAdd`: the chain started chip-less (Quick Add), so `steps` may be empty and
 *  leaving it restores `prevQuery`; without it, steps[0] is a row step. */
export type AppendChain = {mode: "append"; steps: ChainStep[]; quickAdd?: {prevQuery: string}}
/** confirm: the trimmed query the "create [[q]]" prompt is armed for. */
export type ReparentChain = {mode: "reparent"; children: RowRef[]; prevQuery: string; confirm: string | null}
export type ChainState = AppendChain | ReparentChain

/** A content-pane buffer: the note's body as loaded or last saved, and the edited text. */
export type NoteBody = {original: string; text: string}

/** Paths of the buffers with unsaved edits, in insertion order. */
export function dirtyBodyPaths(bodies: Record<string, NoteBody>): string[] {
    return Object.entries(bodies).filter(([, b]) => b.text !== b.original).map(([p]) => p)
}

/** The query to restore when the chain is left: the one typed before Quick Add, its first chip or the reparent. */
export function chainPrevQuery(chain: ChainState): string {
    if (chain.mode === "reparent") return chain.prevQuery
    return chain.quickAdd?.prevQuery ?? chain.steps[0]?.prevQuery ?? ""
}

/** Whether the chain shows its own results (`chainResults`) instead of the view's search: always, except Quick Add
 *  before its first chip while the input is a search rather than an entry. */
export function chainReplacesSearch(chain: ChainState, query: string): boolean {
    return chain.mode === "reparent" || chain.steps.length > 0 || isEntryInput(query)
}

/** What an append chain writes: Outline-editor lines plus where they go. */
export type ChainOutline = {parentName?: string; underLine?: UnderLine; lines: OutlineLine[]; nextDepth: number}

export type NewPageTarget = {nodeType: "newPage"; name: string}

/** Rows Move under (`<`) can move: pages and lines (to a new parent), folders and attachments (to a folder). */
export function isMovable(node: ParsedNode): boolean {
    return node.nodeType === "page" || node.nodeType === "text" || node.nodeType === "folder"
        || node.nodeType === "attachment" || node.nodeType === "folderNote"
}

/** Rows `>` (Patch) can add under: pages, headers and lines. */
export function isPatchable(node: ParsedNode): boolean {
    return node.nodeType === "page" || node.nodeType === "header" || node.nodeType === "text"
}

/** True when the moved row can go under a new `[[typed name]]` (pages and lines; folders and attachments need a folder). */
export function canMoveUnderNewPage(node: ParsedNode): boolean {
    return node.nodeType === "page" || node.nodeType === "text"
}

/** The reparent chip's label: the moved row's, or a count for several. */
export function reparentLabel(children: readonly RowRef[]): string {
    return children.length === 1 ? children[0].label : `${children.length} items`
}

/** How `<` moves `child` under `target` (behavior spec R1–R6, plus folders and attachments into a folder). Line plans
 *  carry `head`/`targetHead` "" and no stamp date; the caller reads the heads from the files and dates moves to
 *  another note. `ownPath` gives a page's or attachment's own file. */
export function planReparent(child: RowRef, target: ParsedNode | NewPageTarget, ctx: {
    ownPath: OwnPath
    relation: string
    cfg: DailyNoteConfig
}): ReparentPlan | {error: string} {
    const c = child.node
    if (c.nodeType === "page") {
        const childPath = ctx.ownPath(c)
        const oldName = child.parent?.nodeType === "page" ? child.parent.page : null
        if (target.nodeType === "folder") {
            if (childPath === null) return {error: `[[${c.page}]] has no note to move`}
            return {kind: "to-folder", childPath, folderPath: target.path}
        }
        const newName = target.nodeType === "newPage" ? target.name : target.nodeType === "page" ? target.page : null
        if (newName === null) return {error: "Pick a page or folder"}
        if (newName.toLowerCase() === c.page.toLowerCase()) return {error: "Can't move a page under itself"}
        return {kind: "set-parent", childPath, childName: c.page, relation: ctx.relation, newName, oldName, cfg: ctx.cfg}
    }
    if (c.nodeType === "text") {
        const sourcePath = c.location.path
        const line = c.location.position.start.line
        if (target.nodeType === "text") {
            return {
                kind: "under-line", sourcePath, line, head: "",
                targetPath: target.location.path, targetLine: target.location.position.start.line, targetHead: "",
                stampDate: null,
            }
        }
        // parentLink is the link's target name: the move lands under `- [[parentLink]]`.
        const parentLink = target.nodeType === "newPage" ? target.name
            : target.nodeType === "page" ? target.page
            : target.nodeType === "header" ? `${target.page}#${target.header}`
            : null
        if (parentLink === null) return {error: "Pick a page, header or line"}
        return {kind: "to-daily", sourcePath, line, head: "", parentLink, cfg: ctx.cfg, stampDate: null}
    }
    if (c.nodeType === "folder" || c.nodeType === "attachment") {
        if (target.nodeType !== "folder") return {error: "Pick a folder"}
        if (c.nodeType === "folder") {
            if (target.path === c.path || target.path.startsWith(c.path + "/")) return {error: "Can't move a folder into itself"}
            return {kind: "to-folder", childPath: c.path, folderPath: target.path}
        }
        const childPath = ctx.ownPath(c)
        if (childPath === null) return {error: `${c.name} has no file to move`}
        return {kind: "to-folder", childPath, folderPath: target.path}
    }
    if (c.nodeType === "header") return {error: "Headings can't be moved — move their page or their lines"}
    return {error: "This row can't be moved"}
}

/** Result rows while a chain is active. Reparent: the new-parent candidates for the moved row. Append: link targets
 *  for an open `[[frag` anywhere in the input, else the anchor's children filtered by the query, and nothing once
 *  entries are typed. `query` is the input as typed (entry and link checks); `searchText` is it as searched (`:Name`
 *  filter references expanded). */
export function chainResults(graph: NotesGraph, chain: ChainState, query: string, searchText: string, separator: string, options: SearchOptions, dailyName: string): ResultNode[] {
    if (chain.mode === "append") return appendChainResults(graph, chain, query, searchText, separator, dailyName)
    const q = searchText.trim()
    if (q.length < 3) return []
    const keys = new Set(chain.children.map(c => getKey(c.node)))
    const kinds = new Set(chain.children.map(c => c.node.nodeType))
    const folders = () => pruneResultTree(searchIndex(graph, `${q} is:folder`, separator, options), n => n.nodeType === "folder" && !keys.has(getKey(n)))
    if (!kinds.has("text") && !kinds.has("page")) return folders()
    if (!kinds.has("text")) {
        const pages = pruneResultTree(linkTargetTree(graph, q, separator), n => n.nodeType === "page" && !keys.has(getKey(n)))
        return [...pages, ...folders()]
    }
    const lines = pruneResultTree(partitionArchived(searchIndex(graph, q, separator, options), false).visible,
        n => (n.nodeType === "page" || n.nodeType === "header" || n.nodeType === "text") && !keys.has(getKey(n)))
    return kinds.has("page") || kinds.has("folder") || kinds.has("attachment") ? [...lines, ...folders()] : lines
}

function appendChainResults(graph: NotesGraph, chain: AppendChain, query: string, searchText: string, separator: string, dailyName: string): ResultNode[] {
    const open = openLinkAt(query)
    if (open) return open.fragment.trim() === "" ? [] : linkTargetTree(graph, open.fragment, separator)
    if (chain.steps.some(s => s.kind === "entry")) return []
    if (isEntryInput(query)) return []
    const anchor = lastAnchor(chain.steps)
    const key = anchor.kind === "today" ? `[[${dailyName}]]`
        : anchor.kind === "note" ? `[[${anchor.name}]]`
        : anchor.kind === "header" ? `${anchor.page}#${anchor.header}`
        : getKey(anchor.node)
    const reveal = extractArchiveReveal(parseQuery(searchText, separator)).reveal
    return partitionArchived(advancedSearch(graph, key, searchText, separator), reveal).visible
}

export function lastAnchor(steps: ChainStep[]): ChainAnchor {
    for (let i = steps.length - 1; i >= 0; i--) {
        const s = steps[i]
        if (s.kind === "row") return s.anchor
    }
    return {kind: "today"}
}

/** True when typed text in an append chain is an entry, not a search: `|`, `#`, `(`, a bullet (`-`, `*`, `+`) alone or
 *  before a space, a task box (`[`, `[]`, `[ ]`, `[x]`) alone or before a space, `[[`, `key::`, a markdown link `[…](`. */
export function isEntryInput(text: string): boolean {
    return /^(\||#|\(|\[(?:[ xX]?\])?(?:\s|$)|[-*+](?:\s|$)|\[\[|[A-Za-z][\w-]*::|\[(?:\\.|[^\]\\])*\]\()/.test(text.trimStart())
}

const FIELD_PAREN_RE = /^\(\s*([A-Za-z][\w -]*?)\s*::\s*(.*?)\s*\)$/
const FIELD_BARE_RE = /^([A-Za-z][\w-]*)::\s*(.*)$/

/** The chain entry typed text is: null when blank, an error for an open link or a bad field. */
export function parseChainEntry(text: string): ChainEntry | null | {error: string} {
    const t = text.trim()
    if (t === "") return null
    if (openLinkAt(t) !== null) return {error: "Close the link: [[name]]"}
    const alias = t.match(/^\|\s*(.+)$/)
    if (alias) return {kind: "alias", alias: alias[1].trim()}
    const heading = t.match(/^#{1,6}\s*(\S.*)$/)
    if (heading) return {kind: "heading", text: heading[1].trim()}
    const field = t.match(FIELD_PAREN_RE) ?? t.match(FIELD_BARE_RE)
    if (field) {
        if (field[2].trim() === "") return {error: "Type a value after ::"}
        if (field[1].toLowerCase().startsWith("meta-")) return {error: "meta- fields are reserved"}
        return {kind: "field", key: field[1], value: field[2].trim()}
    }
    const link = parseLinkBullet(t)
    if (link) return {kind: "note", link}
    let rest = t.replace(/^[-*+](?:\s+|$)/, "")
    if (rest === "[") return null // a task box still being typed
    let marker: "- " | "- [ ] " | "- [x] " = "- "
    const box = rest.match(/^\[([ xX]?)\](?:\s+|$)/)
    if (box) {
        marker = box[1].toLowerCase() === "x" ? "- [x] " : "- [ ] "
        rest = rest.slice(box[0].length)
    }
    rest = rest.trim()
    return rest === "" ? null : {kind: "item", marker, text: rest}
}

/** The entry `>` pre-fills when it anchors today with no row selected: an item built from the search text `query`
 *  (filter references expanded) so the written line matches it. Its last stage only; words, quoted text and tags as
 *  typed; `[[Note]]` as a link; `is:task`/`is:subtask` → `- [ ] `, `is:completed` → `- [x] ` (first wins), `is:archived`
 *  → `#<archiveTag>`, `has:emoji` → 🪴, `has:link`/`has:page` → a trailing open `[[` (none if a link is already there);
 *  an OR group by its first alternative. Negations, `in:`, `outline:` and other `is:` values add nothing.
 *  "" for a blank query. */
export function chainPrefill(query: string, separator: string, archiveTag: string): string {
    if (query.trim() === "") return ""
    const stages = parseQuery(query, separator, true)
    const parts: string[] = []
    let box: "- [ ] " | "- [x] " | null = null
    let openLink = false
    const walk = (e: QueryExpr): void => {
        switch (e.type) {
            case "contains":
            case "equals": parts.push(e.value); return
            case "and": e.exprs.forEach(walk); return
            case "or": walk(e.exprs[0]); return
            case "not":
            case "empty": return
            case "modifier":
                if (e.field === "tree") parts.push(`[[${e.value}]]`)
                else if (e.field === "is" && (e.value === "task" || e.value === "subtask")) box ??= "- [ ] "
                else if (e.field === "is" && e.value === "completed") box ??= "- [x] "
                else if (e.field === "is" && e.value === "archived") parts.push(`#${archiveTag}`)
                else if (e.field === "has" && e.value === "emoji") parts.push("🪴")
                else if (e.field === "has" && (e.value === "link" || e.value === "page")) openLink = true
                return
        }
    }
    walk(stages[stages.length - 1])
    const marker = box ?? "- "
    if (openLink && !parts.some(p => p.startsWith("[["))) return marker + [...parts, "[["].join(" ")
    return marker + parts.map(p => p + " ").join("")
}

type WorkLine = {depth: number; marker: OutlineLine["marker"]; text: string; link: LinkBullet | null}

/** The Outline-editor lines an append chain writes: its entry steps, then `entry` (the typed, not yet pushed input),
 *  under the last row step's anchor. Links nest; a heading re-points the anchor note's root link; aliases and fields
 *  patch the current note's link line. */
export function chainOutline(steps: ChainStep[], entry: ChainEntry | null, dailyName: string): ChainOutline | {error: string} {
    const anchor = lastAnchor(steps)
    const lines: WorkLine[] = []
    const linkLine = (depth: number, link: LinkBullet): WorkLine => {
        const l = {depth, marker: "- ", text: "", link}
        lines.push(l)
        return l
    }
    const bare = (name: string, header: string | null = null): LinkBullet => ({name, header, alias: null, fields: []})

    let cur: WorkLine | null = null
    let curNote: string | null = null
    let depth = 0
    let anchorLine: WorkLine | null = null
    let patchRoot: WorkLine | null = null
    if (anchor.kind === "today") curNote = dailyName
    else if (anchor.kind === "note") {
        cur = anchorLine = linkLine(0, bare(anchor.name))
        curNote = anchor.name
        depth = 1
    } else if (anchor.kind === "header") {
        cur = linkLine(0, bare(anchor.page, anchor.header))
        curNote = anchor.page
        depth = 1
    }

    const entries = steps.flatMap(s => s.kind === "entry" ? [s.entry] : [])
    if (entry) entries.push(entry)
    for (const e of entries) {
        switch (e.kind) {
            case "note":
                cur = linkLine(depth, {...e.link, fields: [...e.link.fields]})
                curNote = e.link.name
                depth++
                anchorLine = null
                break
            case "heading":
                if (curNote === null) return {error: "Headings go under a note — pick one or type [[name]] first"}
                if (anchorLine?.link) {
                    anchorLine.link.header = e.text
                    anchorLine = null
                } else {
                    cur = linkLine(depth, bare(curNote, e.text))
                    depth++
                }
                break
            case "alias":
            case "field": {
                if (curNote === null) return {error: "Aliases and properties apply to notes — pick one or type [[name]] first"}
                const note = curNote
                let target: WorkLine
                if (cur?.link && cur.link.name.toLowerCase() === note.toLowerCase()) target = cur
                else target = patchRoot ??= linkLine(0, bare(note))
                const link = target.link!
                if (e.kind === "field") link.fields.push({key: e.key, value: e.value})
                else if (link.alias === null) link.alias = e.alias
                else link.fields.push({key: "aliases", value: e.alias})
                break
            }
            case "item":
                cur = {depth, marker: e.marker, text: e.text, link: null}
                lines.push(cur)
                curNote = null
                depth++
                anchorLine = null
                break
        }
    }

    const out: OutlineLine[] = lines.map(l => ({depth: l.depth, marker: l.marker, text: l.link ? renderLinkBullet(l.link) : l.text}))
    return {
        ...(anchor.kind === "note" ? {parentName: anchor.name} : {}),
        ...(anchor.kind === "header" ? {parentName: `${anchor.page}#${anchor.header}`} : {}),
        ...(anchor.kind === "line" ? {underLine: anchor.target} : {}),
        lines: out,
        nextDepth: depth,
    }
}

/** The Outline-editor text for a chain: its lines, then an empty bullet under the deepest one, caret at the end. */
export function chainEditorText(o: ChainOutline): {outline: string; caret: number} {
    const outline = [...renderOutline(o.lines, 0), "    ".repeat(o.nextDepth) + "- "].join("\n")
    return {outline, caret: outline.length}
}

const cut = (s: string, n = 40) => s.length > n ? s.slice(0, n - 1) + "…" : s

/** A row's chip label: its plain text without inline fields (`[scheduled:: …]`), cut to 40 characters. */
export function rowLabel(node: ParsedNode): string {
    return cut(nodeLabel(node).replace(/\s*[\[(][^\[\]()]*::[^\[\]()]*[\])]/g, "").trim())
}
