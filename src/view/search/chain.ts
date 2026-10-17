// Search chains, pure: reparent (`<`, Move under), one chip for the moved rows (one row, or the cut drawer's); the
// planning below decides where each goes. Also the row helpers the outline editor (outline.ts) shares: patchPath,
// chainPrefill, rowLabel. No obsidian value imports; the atoms in state.tsx / EditorMolecule.ts run the plans.
import {
    fileParent,
    flattenIndex,
    getKey,
    linkTargetTree,
    matchQuery,
    parseQuery,
    partitionArchived,
    pruneResultTree,
    searchIndex,
    type NotesGraph,
    type ParsedNode,
    type QueryExpr,
    type ResultNode,
    type SearchOptions,
} from "@mdtree/core"
import type {ReparentPlan} from "../../editing/vault-edits"
import type {DailyNoteConfig} from "../../indexing/indexed-tree"
import {treeParentPos, type OwnPath} from "../editor/row-editing"
import type {TreeNode} from "./SearchViewFlatten"
import {nodeLabel} from "./timeline-utils"

/** A result row a chip stands for: its node (with the row's location) and the node of its tree parent row (Tree mode). */
export type RowRef = {node: ParsedNode; label: string; parent: ParsedNode | null}

/** confirm: the trimmed query the "create [[q]]" prompt is armed for. */
export type ChainState = {mode: "reparent"; children: RowRef[]; prevQuery: string; confirm: string | null}

/** What a content pane edits: a note's body (`heading` null: its text after the leading outline) or the text under one
 *  of its headings. `key`: `path`, or `path#heading`; `label`: the note's name, or `Note > Heading`. */
export type BodyRef = {key: string; path: string; heading: string | null; label: string}

/** A content-pane buffer: its text as loaded or last saved, and the edited text. */
export type NoteBody = BodyRef & {original: string; text: string}

/** Keys of the buffers with unsaved edits, in insertion order. */
export function dirtyBodyKeys(bodies: Record<string, NoteBody>): string[] {
    return Object.entries(bodies).filter(([, b]) => b.text !== b.original).map(([k]) => k)
}

/** The rows the outline editor's path crumbs stand for when the row at `pos` opens, top-down (Parent > Child > … >
 *  the row). In the outline editor (`underRoot`) the rows are the root's tree, so it is the row's tree ancestors and
 *  the row; otherwise the in-note context of its top ancestor (fileParent: its heading, parent line and note) comes
 *  first. Rows that can't be a root (folders, months, the Archive row) are skipped. */
export function patchPath(graph: NotesGraph, rows: TreeNode[], pos: number, underRoot: boolean): ParsedNode[] {
    const path: ParsedNode[] = []
    for (let p: number | null = pos; p !== null; p = treeParentPos(rows, p)) {
        if (!rows[p].archiveRow && isPatchable(rows[p].node)) path.unshift(rows[p].node)
    }
    if (!underRoot && path.length > 0) {
        const seen = new Set(path.map(getKey))
        for (let n = fileParent(graph, path[0]); n !== null && !seen.has(getKey(n)); n = fileParent(graph, n)) {
            seen.add(getKey(n))
            path.unshift(n)
        }
    }
    return path
}

/** Whether `node` is the note `page` (`heading` undefined) or its heading `heading`: the row a link to it opens. */
export function linksTo(node: ParsedNode, page: string, heading: string | undefined): boolean {
    if (heading === undefined) return node.nodeType === "page" && node.page.toLowerCase() === page.toLowerCase()
    return node.nodeType === "header" && node.page.toLowerCase() === page.toLowerCase() && node.header.toLowerCase() === heading.toLowerCase()
}

export type NewPageTarget = {nodeType: "newPage"; name: string}

/** Rows Move under (`<`) can move: pages and lines (to a new parent), folders and attachments (to a folder). */
export function isMovable(node: ParsedNode): boolean {
    return node.nodeType === "page" || node.nodeType === "text" || node.nodeType === "folder"
        || node.nodeType === "attachment" || node.nodeType === "folderNote"
}


/** Rows the outline editor can open on (be a root): pages, headers and lines. */
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

/** Result rows while reparenting: the new-parent candidates for the moved rows. `searchText` is the query as searched
 *  (`:Name` filter references expanded). */
export function chainResults(graph: NotesGraph, chain: ChainState, searchText: string, separator: string, options: SearchOptions): ResultNode[] {
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

/** The line `>` pre-fills when it opens Today with no row selected: an item built from the search text `query`
 *  (filter references expanded) so the written line matches it. Its last stage only; words, quoted text and tags as
 *  typed; `[[Note]]` as a link; `is:task`/`is:subtask` → `- [ ] `, `is:completed` → `- [x] ` (first wins), `is:archived`
 *  → `#<archiveTag>`, `has:emoji` → 🪴, `has:link`/`has:page` → a trailing open `[[` (none if a link is already there);
 *  an OR group by its first alternative. Negations, `in:`, `outline:` and other `is:` values add nothing.
 *  "" for a blank query. `skipTree`: a `[[Note]]` scope naming that note adds nothing (the line goes under the note). */
export function chainPrefill(query: string, separator: string, archiveTag: string, skipTree?: string): string {
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
                if (e.field === "tree") { if (e.value !== skipTree) parts.push(`[[${e.value}]]`) }
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

/** Where Add to writes for the search text `query`, and the line it pre-fills: a `[[Note]]` scope in the first stage
 *  (`[[Note]] > is:task home`) is the note the line goes under, and the line is chainPrefill's of the last stage
 *  without that scope (`- [ ] home `); otherwise no note (Today) and the whole chainPrefill. */
export type AddToPlan = {note: string | null; parentQuery: string | null; filter: string; prefill: string}

function queryOf(expr: QueryExpr, parent?: "and" | "or"): string {
    let query: string
    switch (expr.type) {
        case "empty": query = ""; break
        case "contains": query = expr.value; break
        case "equals": query = `"${expr.value}"`; break
        case "not": query = `-(${queryOf(expr.expr)})`; break
        case "and": query = expr.exprs.map(e => queryOf(e, "and")).filter(Boolean).join(" "); break
        case "or": query = expr.exprs.map(e => queryOf(e, "or")).filter(Boolean).join(" | "); break
        case "modifier":
            query = expr.field === "tree" ? `[[${expr.value}]]`
                : expr.field === "outline" && expr.exact ? `outline:"${expr.value}"`
                : `${expr.field}:${expr.value}`
            break
    }
    if (parent === "and" && expr.type === "or") return `(${query})`
    return query
}

function withoutTreeScope(expr: QueryExpr): {scope: QueryExpr | null; filter: QueryExpr} {
    if (expr.type === "modifier" && expr.field === "tree") return {scope: expr, filter: {type: "empty"}}
    if (expr.type !== "and") return {scope: null, filter: expr}
    const scope = expr.exprs.find(e => e.type === "modifier" && e.field === "tree") ?? null
    if (!scope) return {scope: null, filter: expr}
    const rest = expr.exprs.filter(e => e !== scope)
    return {scope, filter: rest.length === 0 ? {type: "empty"} : rest.length === 1 ? rest[0] : {type: "and", exprs: rest}}
}

function treeScopeOf(expr: QueryExpr): string | null {
    if (expr.type === "modifier" && expr.field === "tree") return expr.value
    if (expr.type === "and") return expr.exprs.find(e => e.type === "modifier" && e.field === "tree")?.type === "modifier"
        ? (expr.exprs.find(e => e.type === "modifier" && e.field === "tree") as Extract<QueryExpr, {type: "modifier"}>).value
        : null
    return null
}

/** Splits the final filter from its parent query and pre-fills a line from that filter. */
export function addToPlan(query: string, separator: string, archiveTag: string): AddToPlan {
    const stages = parseQuery(query, separator, true).filter(e => e.type !== "empty")
    if (stages.length === 0) return {note: null, parentQuery: null, filter: "", prefill: ""}

    const last = stages[stages.length - 1]
    const {scope, filter} = withoutTreeScope(last)
    const parentStages = stages.slice(0, -1)
    if (scope && scope.type !== "empty") parentStages.push(scope)
    const filterQuery = queryOf(filter)
    const parentQuery = parentStages.length > 0 ? parentStages.map(e => queryOf(e)).filter(Boolean).join(` ${separator} `) || null : null
    const note = parentStages.length === 1 ? treeScopeOf(parentStages[0]) : null
    return {note, parentQuery, filter: filterQuery, prefill: filterQuery === "" && parentQuery ? "- " : chainPrefill(filterQuery, separator, archiveTag)}
}

function needsNestedParent(query: string, separator: string): boolean {
    const hasNestedModifier = (expr: QueryExpr): boolean => {
        switch (expr.type) {
            case "modifier": return expr.field === "is" && (expr.value === "subtext" || expr.value === "subtask")
            case "and":
            case "or": return expr.exprs.some(hasNestedModifier)
            case "not": return false
            default: return false
        }
    }
    return parseQuery(query, separator, true).some(hasNestedModifier)
}

/** Whether an outline parent can contain the node shape requested by the final filter. */
export function canAddToParent(parent: ParsedNode | null, filter: string, separator: string): boolean {
    if (needsNestedParent(filter, separator)) return parent?.nodeType === "text"
    return parent === null || isPatchable(parent)
}

/** The first ranked result matching the parent's final stage that can contain the line described by `filter`. */
export function selectCandidateParent(results: ResultNode[], parentQuery: string, separator: string, filter: string): ParsedNode | null {
    const parentStages = parseQuery(parentQuery, separator, true).filter(e => e.type !== "empty")
    const match = parentStages[parentStages.length - 1]
    if (!match) return null
    return flattenIndex(results, 10, parentStages, {expandAll: true})
        .find(row => matchQuery(row.node, match) && canAddToParent(row.node, filter, separator))
        ?.node ?? null
}

const cut = (s: string, n = 40) => s.length > n ? s.slice(0, n - 1) + "…" : s

/** A row's chip label: its plain text without inline fields (`[scheduled:: …]`), cut to 40 characters. */
export function rowLabel(node: ParsedNode): string {
    return cut(nodeLabel(node).replace(/\s*[\[(][^\[\]()]*::[^\[\]()]*[\])]/g, "").trim())
}
