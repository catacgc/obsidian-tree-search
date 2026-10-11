// Filter pills (RecencyFilterBar): detect and add or remove a filter's query text in the search query.
import type {EditorHint} from "@mdtree/core"
import type {SearchFilter} from "../react-context/settings"

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

/** Removes every standalone `filterQuery` (with the whitespace before it, then leading whitespace), else appends
 *  ` <filterQuery trimmed>` (or sets it when the query is blank). */
export function toggleFilter(query: string, filterQuery: string): string {
    if (hasFilter(query, filterQuery)) return query.replace(filterRe(filterQuery), "").replace(/^\s+/, "")
    const text = filterQuery.trim()
    const trimmed = query.replace(/\s+$/, "")
    return trimmed ? `${trimmed} ${text}` : text
}

/** Same query text ignoring surrounding and repeated whitespace. */
export function sameFilterQuery(a: string, b: string): boolean {
    const norm = (s: string) => s.trim().replace(/\s+/g, " ")
    return norm(a) === norm(b)
}

/** A filter name as saved: whitespace runs collapsed, trimmed. */
export const normalizeFilterName = (name: string): string => name.replace(/\s+/g, " ").trim()

/** Index of the filter named `name` (normalized, case-insensitive), or -1. */
export function filterIndexNamed(name: string, filters: readonly SearchFilter[]): number {
    const lower = normalizeFilterName(name).toLowerCase()
    return filters.findIndex(f => normalizeFilterName(f.name).toLowerCase() === lower)
}

/** Editor hints for a new filter's name: blank → blocking "Name the filter"; a name equal (case-insensitive,
 *  trimmed) to an existing filter's → non-blocking `"<existing name>" already exists` (Save becomes Replace); else []. */
export function filterNameHints(name: string, filters: readonly SearchFilter[]): EditorHint[] {
    if (normalizeFilterName(name) === "") return [{text: "Name the filter", blocking: true}]
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
