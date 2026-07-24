import { IS_VALUES, HAS_VALUES } from "./query.ts"

export type Suggestion = { label: string; insertText: string }

export function suggestAt(query: string, cursorPos: number): Suggestion[] {
  // The token immediately before the cursor is everything since the last
  // space (or the start of the string, if there is no earlier space).
  const before = query.slice(0, cursorPos)
  const tokenStart = before.lastIndexOf(" ") + 1
  const token = before.slice(tokenStart).toLowerCase()

  // Only a complete "is:x" or "has:x" token triggers suggestions — bare
  // letters or a leading ":" don't (see the design doc's Non-goals: bare
  // letters collide with normal search terms, and a leading ":" belongs
  // only to the legacy grammar, not this one).
  const match = /^(is|has):([a-z]*)$/.exec(token)
  if (!match) return []

  const [, field, typed] = match
  const values = field === "is" ? IS_VALUES : HAS_VALUES
  return values
    .filter(v => v.startsWith(typed) && v !== typed)
    .map(v => ({ label: `${field}:${v}`, insertText: `${field}:${v}` }))
}

export function spliceSuggestion(
  query: string,
  cursorPos: number,
  insertText: string
): { query: string; cursorPos: number } {
  const before = query.slice(0, cursorPos)
  const tokenStart = before.lastIndexOf(" ") + 1
  const after = query.slice(cursorPos)
  const newQuery = query.slice(0, tokenStart) + insertText + after
  return { query: newQuery, cursorPos: tokenStart + insertText.length }
}
