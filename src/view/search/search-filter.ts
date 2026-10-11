// Saved filters: `:Name` references in a query (scan, expand, pill toggle, autocomplete) and filter names.
import type {EditorHint, Suggestion} from "@mdtree/core"
import type {SearchFilter} from "../react-context/settings"

/** A filter name: letters, digits, `_` and `-`, so `:Name` is one query word. */
export const FILTER_NAME_RE = /^[\p{L}\p{N}_-]+$/u

const NAME_CH_RE = /[\p{L}\p{N}_-]/u
const NAME_RUN_RE = /^[\p{L}\p{N}_-]+/u

/** A `:name` (or negated `-:name`) reference at query[start, end); `name` as typed. */
export type FilterRef = {start: number; end: number; name: string; negated: boolean}

/** Every `:name` / `-:name` word in `query`, outside "quoted" text and [[links]]. A `:` right after a name
 *  character or another `:` (`x:y`, `10:30`, `a::b`, `x-:y`) starts no reference, nor does a name followed by `:`. */
export function scanFilterRefs(query: string): FilterRef[] {
    const refs: FilterRef[] = []
    let i = 0
    while (i < query.length) {
        const c = query[i]
        if (c === '"') {
            const close = query.indexOf('"', i + 1)
            if (close < 0) break
            i = close + 1
            continue
        }
        if (c === "[" && query[i + 1] === "[") {
            const close = query.indexOf("]]", i + 2)
            if (close < 0) break
            i = close + 2
            continue
        }
        const colon = c === ":" ? i : c === "-" && query[i + 1] === ":" ? i + 1 : -1
        if (colon >= 0 && (i === 0 || !(NAME_CH_RE.test(query[i - 1]) || query[i - 1] === ":"))) {
            const name = NAME_RUN_RE.exec(query.slice(colon + 1))?.[0]
            const end = colon + 1 + (name?.length ?? 0)
            if (name && query[end] !== ":") {
                refs.push({start: i, end, name, negated: c === "-"})
                i = end
                continue
            }
        }
        i++
    }
    return refs
}

/** `query` with each reference to a saved filter (case-insensitive name) replaced by that filter's query, itself
 *  expanded (a reference back to a filter being expanded stays as typed). Wrapped in parentheses so `-` and `|`
 *  apply to it whole, unless it contains `separator` (its stages must stay top-level). Unknown names stay as typed
 *  (plain text). */
export function expandFilterRefs(query: string, filters: readonly SearchFilter[], separator: string, expanding: readonly string[] = []): string {
    if (!query.includes(":")) return query
    let out = ""
    let last = 0
    for (const ref of scanFilterRefs(query)) {
        const lower = ref.name.toLowerCase()
        const f = filters.find(f => f.name.toLowerCase() === lower)
        if (!f || expanding.includes(lower)) continue
        const body = expandFilterRefs(f.query.trim(), filters, separator, [...expanding, lower])
        const inner = separator !== "" && body.includes(separator) ? body : `(${body})`
        out += query.slice(last, ref.start) + (ref.negated ? "-" : "") + inner
        last = ref.end
    }
    return out + query.slice(last)
}

/** Regex for standalone occurrences of `filterQuery` in a query: preceded by start or whitespace, followed by
 *  whitespace or end; whitespace runs inside `filterQuery` match any whitespace run. Regex specials are escaped. */
function filterRe(filterQuery: string): RegExp {
    const tokens = filterQuery.trim().split(/\s+/).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    return new RegExp(`(^|\\s+)${tokens.join("\\s+")}(?=\\s|$)`, "g")
}

/** True when `query` contains `filterQuery` standalone (`is:task` doesn't match `-is:task` or `is:tasks`); false for a blank `filterQuery`. */
export function hasFilter(query: string, filterQuery: string): boolean {
    if (filterQuery.trim() === "") return false
    return filterRe(filterQuery).test(query)
}

/** The non-negated references to `filter` (case-insensitive name) in `query`. */
const refsTo = (query: string, filter: SearchFilter): FilterRef[] => {
    const lower = filter.name.toLowerCase()
    return scanFilterRefs(query).filter(r => !r.negated && r.name.toLowerCase() === lower)
}

/** True when the query has a non-negated reference to `filter` or (as before) its query text standalone (hasFilter). */
export function filterActive(query: string, filter: SearchFilter): boolean {
    return refsTo(query, filter).length > 0 || hasFilter(query, filter.query)
}

/** Pill click: when filterActive, removes every non-negated reference to `filter` (with the whitespace before it)
 *  and every standalone occurrence of its query text, then leading whitespace; else appends ` :<name>`
 *  (or sets `:<name>` when the query is blank). */
export function toggleFilterPill(query: string, filter: SearchFilter): string {
    if (filterActive(query, filter)) {
        let next = query
        for (const ref of refsTo(query, filter).reverse()) {
            let wsStart = ref.start
            while (wsStart > 0 && /\s/.test(next[wsStart - 1])) wsStart--
            next = next.slice(0, wsStart) + next.slice(ref.end)
        }
        if (hasFilter(next, filter.query)) next = next.replace(filterRe(filter.query), "")
        return next.replace(/^\s+/, "")
    }
    const trimmed = query.replace(/\s+$/, "")
    return trimmed ? `${trimmed} :${filter.name}` : `:${filter.name}`
}

/** Same query text ignoring surrounding and repeated whitespace. */
export function sameFilterQuery(a: string, b: string): boolean {
    const norm = (s: string) => s.trim().replace(/\s+/g, " ")
    return norm(a) === norm(b)
}

/** An autocomplete row for a saved filter (SearchBar accepts it with Tab or Enter; RecencyFilterBar highlights its pill). */
export type FilterSuggestion = Suggestion & {filterName: string}

export function isFilterSuggestion(s: Suggestion): s is FilterSuggestion {
    return "filterName" in s
}

/** Filters for the `:prefix` / `-:prefix` word before the caret (the word since the last space, as spliceSuggestion
 *  replaces): names starting with the prefix (case-insensitive), in saved order, minus an exact match. */
export function filterSuggestionsAt(query: string, cursorPos: number, filters: readonly SearchFilter[]): FilterSuggestion[] {
    const before = query.slice(0, cursorPos)
    const m = /^(-?):([\p{L}\p{N}_-]*)$/u.exec(before.slice(before.lastIndexOf(" ") + 1))
    if (!m) return []
    const [, neg, typed] = m
    const prefix = typed.toLowerCase()
    const space = /^\s/.test(query.slice(cursorPos)) ? "" : " "
    return filters
        .filter(f => {
            const lower = f.name.toLowerCase()
            return lower.startsWith(prefix) && lower !== prefix
        })
        .map(f => ({label: `:${f.name}`, insertText: `${neg}:${f.name}${space}`, detail: f.query, filterName: f.name}))
}

/** A filter name as saved: trimmed. */
export const normalizeFilterName = (name: string): string => name.trim()

/** Index of the filter named `name` (normalized, case-insensitive), or -1. */
export function filterIndexNamed(name: string, filters: readonly SearchFilter[]): number {
    const lower = normalizeFilterName(name).toLowerCase()
    return filters.findIndex(f => normalizeFilterName(f.name).toLowerCase() === lower)
}

/** Editor hints for a new filter's name: blank → blocking "Name the filter"; characters other than letters,
 *  digits, `-` and `_` → blocking; a name equal (case-insensitive, trimmed) to an existing filter's →
 *  non-blocking `"<existing name>" already exists` (Save becomes Replace); else []. */
export function filterNameHints(name: string, filters: readonly SearchFilter[]): EditorHint[] {
    const trimmed = normalizeFilterName(name)
    if (trimmed === "") return [{text: "Name the filter", blocking: true}]
    if (!FILTER_NAME_RE.test(trimmed)) return [{text: 'Use letters, digits, "-" or "_"', blocking: true}]
    const i = filterIndexNamed(name, filters)
    if (i >= 0) return [{text: `"${filters[i].name}" already exists`, blocking: false}]
    return []
}

/** `filters` with `{name, query}` saved: it replaces the filter with the same name in place, else is appended. */
export function saveFilter(filters: readonly SearchFilter[], name: string, query: string): SearchFilter[] {
    const saved = {name: normalizeFilterName(name), query}
    const i = filterIndexNamed(name, filters)
    return i >= 0 ? filters.map((f, j) => j === i ? saved : f) : [...filters, saved]
}
