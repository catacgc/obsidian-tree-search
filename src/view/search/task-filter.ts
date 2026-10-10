// The Tasks chip's `is:task` toggle (RecencyFilterBar): detects and adds or removes the token in the query text.

const TOKEN = "is:task"
const TOKEN_RE = /(^|\s+)is:task(?=\s|$)/g

/** True when `query` has a standalone `is:task` token (not `-is:task`, not `is:tasks`). */
export function hasTaskFilter(query: string): boolean {
    TOKEN_RE.lastIndex = 0
    return TOKEN_RE.test(query)
}

/** Removes every standalone `is:task` (with the whitespace before it), else appends ` is:task`. */
export function toggleTaskFilter(query: string): string {
    if (hasTaskFilter(query)) return query.replace(TOKEN_RE, "").replace(/^\s+/, "")
    const trimmed = query.replace(/\s+$/, "")
    return trimmed ? `${trimmed} ${TOKEN}` : TOKEN
}
