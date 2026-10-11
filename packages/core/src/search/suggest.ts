import { IS_VALUES, HAS_VALUES } from "./query.ts"

/** `detail`: secondary text shown after the label (e.g. a date). */
export type Suggestion = { label: string; insertText: string; detail?: string }

export function suggestAt(query: string, cursorPos: number): Suggestion[] {
  // The token immediately before the cursor is everything since the last
  // space (or the start of the string, if there is no earlier space).
  const before = query.slice(0, cursorPos)
  const tokenStart = before.lastIndexOf(" ") + 1
  const token = before.slice(tokenStart).toLowerCase()

  // Only a complete "is:x" / "has:x" / "in:x" token triggers suggestions — bare
  // letters don't (see the design doc's Non-goals: bare letters collide with
  // normal search terms). Digits are allowed so `in:7` can be completed.
  const match = /^(is|has|in):([a-z0-9]*)$/.exec(token)
  if (!match) return []

  const [, field, typed] = match
  if (field === "in") return suggestDurations(typed)

  const values = field === "is" ? IS_VALUES : HAS_VALUES
  return values
    .filter(v => v.startsWith(typed) && v !== typed)
    .map(v => ({ label: `${field}:${v}`, insertText: `${field}:${v}` }))
}

// Suggestions for `in:` durations. With no number typed we offer canonical
// presets; once a number is present we complete it with each unit.
function suggestDurations(typed: string): Suggestion[] {
  const m = /^(\d*)([a-z]*)$/.exec(typed)
  if (!m) return []
  const [, num, unit] = m
  const values = num
    ? ["d", "w", "m", "y"].filter(u => u.startsWith(unit) && u !== unit).map(u => `${num}${u}`)
    : ["7d", "1m", "1y"].filter(v => v.startsWith(unit))
  return values.map(v => ({ label: `in:${v}`, insertText: `in:${v}` }))
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
