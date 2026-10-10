import type { ParsedNode } from "../graph/types.ts"
import { isUndated } from "../graph/boost.ts"

export type QueryModifierField = "is" | "has" | "in" | "outline" | "tree"

export type QueryExpr =
  | { type: "contains"; value: string }
  | { type: "empty" }
  | { type: "equals"; value: string }
  | { type: "not"; expr: QueryExpr }
  | { type: "and"; exprs: QueryExpr[] }
  | { type: "or"; exprs: QueryExpr[] }
  // `exact`: a quoted `outline:"name"`, `:daily`, or a `[[note]]` (field `tree`), matched whole rather than as a fragment.
  | { type: "modifier"; field: QueryModifierField; value: string; exact?: true }

export const IS_VALUES = ["page", "header", "text", "folder", "attachment", "task", "subtask", "subtext", "list", "completed", "undated", "archived"]
export const HAS_VALUES = ["emoji", "link", "page"]

// `outline:` target written by the `:daily` shortcut: today's daily note, which
// only the runtime can name (`SearchOptions.dailyNote`). A note name can't
// contain ":", so it never collides with an `outline:<note>` value.
export const DAILY_NOTE = ":daily"

// Intrinsic archive check: a node authored as archived via any of the three
// forms. The index-time derived `archived` flag covers page frontmatter and
// line `#archive` tags; the `(meta-mdtree:: archive)` directive is also
// detected directly from tokens so directly-constructed text nodes work too.
// This is *intrinsic* only — path-contextual propagation to descendants is
// applied at query time in `partitionArchived`.
export function isArchived(node: ParsedNode): boolean {
  if (node.archived === true) return true
  return (
    node.nodeType === "text" &&
    node.parsedTokens.some(
      t => t.tokenType === "meta_mdtree" && t.directive === "archive",
    )
  )
}

// `in:<n><unit>` durations, expressed in whole days. Both short (d/w/m/y) and
// long (day/week/month/year, singular or plural) forms are accepted. `m` is
// "month", not minutes — recency is only meaningful at day granularity here.
const UNIT_DAYS: Record<string, number> = {
  d: 1, day: 1, days: 1,
  w: 7, week: 7, weeks: 7,
  m: 30, month: 30, months: 30,
  y: 365, year: 365, years: 365,
}

export function parseDuration(value: string): number | null {
  const m = /^(\d+)\s*([a-z]+)$/.exec(value.trim().toLowerCase())
  if (!m) return null
  const n = parseInt(m[1], 10)
  const unit = UNIT_DAYS[m[2]]
  if (unit === undefined || n <= 0) return null
  return n * unit
}

const LEGACY_MODIFIERS: Record<string, { field: QueryModifierField; value: string; exact?: true }> = {
  page: { field: "is", value: "page" },
  header: { field: "is", value: "header" },
  folder: { field: "is", value: "folder" },
  attachment: { field: "is", value: "attachment" },
  task: { field: "is", value: "task" },
  subtask: { field: "is", value: "subtask" },
  subtext: { field: "is", value: "subtext" },
  list: { field: "is", value: "list" },
  completed: { field: "is", value: "completed" },
  archived: { field: "is", value: "archived" },
  emoji: { field: "has", value: "emoji" },
  daily: { field: "outline", value: DAILY_NOTE, exact: true },
}

function resolveUniquePrefix(candidates: string[], typed: string): string | null {
  if (candidates.includes(typed)) return typed
  const matches = candidates.filter(c => c.startsWith(typed))
  return matches.length === 1 ? matches[0] : null
}

// ── Tokenizer ─────────────────────────────────────────────────────────────────

type Token =
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "pipe" }
  | { kind: "minus" }
  | { kind: "stage" }
  | { kind: "word"; value: string }
  | { kind: "quoted"; value: string }
  | { kind: "link"; value: string }

function tokenize(input: string, separator: string): Token[] {
  const tokens: Token[] = []
  const isDelimiter = (c: string) => c === "(" || c === ")" || c === "|" || c === separator || c === '"'
  let i = 0
  let depth = 0

  while (i < input.length) {
    const c = input[i]

    if (/\s/.test(c)) { i++; continue }
    if (c === "(") { tokens.push({ kind: "lparen" }); depth++; i++; continue }
    if (c === ")") { tokens.push({ kind: "rparen" }); depth = Math.max(0, depth - 1); i++; continue }
    if (c === "|") { tokens.push({ kind: "pipe" }); i++; continue }
    if (c === separator) {
      // Inside parentheses the stage separator isn't meaningful (design doc:
      // "`.` cannot appear inside parentheses") — treat it as a plain word
      // boundary instead of splitting into a new stage.
      if (depth === 0) tokens.push({ kind: "stage" })
      i++
      continue
    }
    if (c === "-") { tokens.push({ kind: "minus" }); i++; continue }

    if (c === '"') {
      let j = i + 1
      let value = ""
      while (j < input.length && input[j] !== '"') { value += input[j]; j++ }
      tokens.push({ kind: "quoted", value })
      i = j + 1
      continue
    }

    // `[[name]]` / `[[name|alias]]`: one link token naming a note (or `note#heading`); separators,
    // `|` and spaces inside belong to the name. An open `[[` (no `]]` after it) is dropped, so the
    // fragment's words tokenize as usual.
    if (c === "[" && input[i + 1] === "[") {
      const close = input.indexOf("]]", i + 2)
      if (close === -1) { i += 2; continue }
      const name = input.slice(i + 2, close).split("|")[0].trim()
      if (name !== "") tokens.push({ kind: "link", value: name })
      i = close + 2
      continue
    }

    // Bareword: read until whitespace or a delimiter. A '-' does not stop
    // this scan once started, so "well-known" stays one word — only a
    // fresh '-' at a token boundary (handled above) is ever an operator.
    let j = i
    let value = ""
    while (j < input.length && !/\s/.test(input[j]) && !isDelimiter(input[j])) {
      value += input[j]
      j++
    }
    // `outline:"name with spaces"`: the quoted name belongs to the field, and
    // keeps its quotes so matchField can tell an exact name from a fragment.
    if (value === "outline:" && input[j] === '"') {
      const close = input.indexOf('"', j + 1)
      value += `"${input.slice(j + 1, close === -1 ? input.length : close)}"`
      j = close === -1 ? input.length : close + 1
    }
    tokens.push({ kind: "word", value })
    i = j
  }

  return tokens
}

// ── Parser (recursive descent) ───────────────────────────────────────────────
//
// Precedence, tightest to loosest: NOT > AND (juxtaposition) > OR (|) > stage.
// query := stage ( SEP stage )*
// stage := orExpr
// orExpr := andExpr ( "|" andExpr )*
// andExpr := notExpr*
// notExpr := "-" atom | atom
// atom := "(" orExpr ")" | field | word | quoted
//
// The parser never throws: unmatched parens or stray operators are absorbed
// so a partially-typed query never crashes live search.

function matchField(word: string): { field: QueryModifierField; value: string; exact?: true } | null {
  const m = /^(is|has|in|outline):(.+)$/.exec(word)
  if (!m) return null
  const field = m[1] as QueryModifierField
  const typedValue = m[2]
  // `in:` values are open-ended durations, not an enum — keep the raw string
  // and validate it at match time via parseDuration. `outline:` names a note:
  // quoted, the exact name; bare, a fragment (searchIndex picks the latest match).
  if (field === "in") return { field, value: typedValue }
  if (field === "outline") {
    return typedValue.startsWith('"') ? { field, value: typedValue.slice(1, -1), exact: true } : { field, value: typedValue }
  }
  const values = field === "is" ? IS_VALUES : HAS_VALUES
  const resolved = resolveUniquePrefix(values, typedValue)
  return { field, value: resolved ?? typedValue }
}

function matchLegacyModifier(word: string): { field: QueryModifierField; value: string; exact?: true } | null {
  const m = /^:([a-z]+)$/.exec(word)
  if (!m) return null
  const resolved = resolveUniquePrefix(Object.keys(LEGACY_MODIFIERS), m[1])
  return resolved ? LEGACY_MODIFIERS[resolved] : null
}

function parseTokens(tokens: Token[]): QueryExpr[] {
  let pos = 0
  const peek = (): Token | undefined => tokens[pos]
  const advance = (): Token | undefined => tokens[pos++]

  function parseStages(): QueryExpr[] {
    const stages = [parseOr()]
    while (peek()?.kind === "stage") {
      advance()
      stages.push(parseOr())
    }
    return stages
  }

  function parseOr(): QueryExpr {
    const first = parseAnd()
    if (peek()?.kind !== "pipe") return first
    const exprs = [first]
    while (peek()?.kind === "pipe") {
      advance()
      exprs.push(parseAnd())
    }
    const meaningful = exprs.filter(e => e.type !== "empty")
    if (meaningful.length === 0) return { type: "empty" }
    if (meaningful.length === 1) return meaningful[0]
    return { type: "or", exprs: meaningful }
  }

  function parseAnd(): QueryExpr {
    const exprs: QueryExpr[] = []
    while (true) {
      const t = peek()
      if (!t || t.kind === "pipe" || t.kind === "stage" || t.kind === "rparen") break
      exprs.push(parseNot())
    }
    if (exprs.length === 0) return { type: "empty" }
    if (exprs.length === 1) return exprs[0]
    return { type: "and", exprs }
  }

  function parseNot(): QueryExpr {
    if (peek()?.kind === "minus") {
      advance()
      const inner = parseAtom()
      if (inner.type === "empty") return { type: "empty" }
      return { type: "not", expr: inner }
    }
    return parseAtom()
  }

  function parseAtom(): QueryExpr {
    const tok = advance()
    if (!tok) return { type: "empty" }

    if (tok.kind === "lparen") {
      const inner = parseOr()
      if (peek()?.kind === "rparen") advance()
      return inner
    }
    if (tok.kind === "quoted") {
      return { type: "equals", value: tok.value }
    }
    if (tok.kind === "link") {
      return { type: "modifier", field: "tree", value: tok.value, exact: true }
    }
    if (tok.kind === "word") {
      const modifier = matchField(tok.value) ?? matchLegacyModifier(tok.value)
      if (modifier) return { type: "modifier", ...modifier }
      return { type: "contains", value: tok.value }
    }
    // A stray operator token in atom position (e.g. dangling "|" or ")")
    // — swallow it rather than crashing.
    return { type: "empty" }
  }

  return parseStages()
}

export function parseQuery(query: string, separator = "."): QueryExpr[] {
  const tokens = tokenize(query.toLowerCase().trim(), separator)
  return parseTokens(tokens)
}

/** The open `[[fragment` a query ends with: its last `[[` with no `]]` after it; null when every link is closed. */
export function openLinkAt(query: string): { start: number; fragment: string } | null {
  const start = query.lastIndexOf("[[")
  if (start === -1 || query.indexOf("]]", start + 2) !== -1) return null
  return { start, fragment: query.slice(start + 2) }
}

// ── Matching ──────────────────────────────────────────────────────────────────

const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u

export function containsEmoji(text: string): boolean {
  return emojiRegex.test(text)
}

function matchModifier(attrs: ParsedNode, field: QueryModifierField, value: string): boolean {
  if (field === "is") {
    switch (value) {
      case "page": return attrs.nodeType === "page"
      case "header": return attrs.nodeType === "header"
      case "text": return attrs.nodeType === "text"
      // A folderNote stands in for its folder, so it satisfies `is:folder` too.
      case "folder": return attrs.nodeType === "folder" || attrs.nodeType === "folderNote"
      case "attachment": return attrs.nodeType === "attachment"
      case "task": return attrs.nodeType === "text" && attrs.isTask === true && attrs.isCompleted !== true
      case "subtask": return attrs.nodeType === "text" && attrs.isTask && !attrs.isCompleted && attrs.nested === true
      case "subtext": return attrs.nodeType === "text" && !attrs.isTask && attrs.nested === true
      case "list": return attrs.nodeType === "text" && attrs.list === true
      case "completed": return attrs.nodeType === "text" && attrs.isTask === true && attrs.isCompleted === true
      case "undated": return isUndated(attrs.ageDays)
      case "archived": return isArchived(attrs)
      default: return false
    }
  }
  if (field === "in") {
    const days = parseDuration(value)
    return days !== null && attrs.ageDays <= days
  }
  // `outline:`/`[[note]]` scope the whole search (searchIndex) rather than testing
  // one node, so every node they let through satisfies them.
  if (field === "outline" || field === "tree") return true
  // field === "has"
  switch (value) {
    case "emoji": return containsEmoji(attrs.searchKey)
    case "link":
      return attrs.nodeType === "text" &&
        attrs.parsedTokens.some(t => t.tokenType === "obsidian_link" || t.tokenType === "link")
    case "page":
      return attrs.nodeType === "text" &&
        attrs.parsedTokens.some(t => t.tokenType === "obsidian_link" && !t.headerName)
    default: return false
  }
}

export function matchQuery(attrs: ParsedNode, expr: QueryExpr): boolean {
  switch (expr.type) {
    case "empty":
      return true
    case "contains":
      return attrs.searchKey.toLowerCase().includes(expr.value.toLowerCase())
    case "equals":
      return attrs.searchKey.toLowerCase() === expr.value.toLowerCase()
    case "not":
      return !matchQuery(attrs, expr.expr)
    case "and":
      return expr.exprs.every(e => matchQuery(attrs, e))
    case "or":
      return expr.exprs.some(e => matchQuery(attrs, e))
    case "modifier":
      return matchModifier(attrs, expr.field, expr.value)
  }
}

export function firstPassInclude(attrs: ParsedNode, expr: QueryExpr): boolean {
  if (expr.type === "not") return !matchQuery(attrs, expr.expr)
  return matchQuery(attrs, expr)
}

// Whether a node counts as a query "match" (a real hit) rather than structural
// context: it satisfies at least one query stage. An empty query matches
// everything (nothing is dimmed). Used to compute the `matched` flag carried on
// each flattened result row.
export function nodeMatchesQuery(attrs: ParsedNode, exprs: QueryExpr[]): boolean {
  return exprs.length === 0 || exprs.some(e => matchQuery(attrs, e))
}

// Whether any stage of the query selects folders (`is:folder`). Drives whether
// folder-containment edges are traversed when building result trees, so folder
// hierarchies surface only when explicitly requested.
export function queryTargetsFolders(exprs: QueryExpr[]): boolean {
  const hasFolderModifier = (e: QueryExpr): boolean => {
    switch (e.type) {
      case "modifier": return e.field === "is" && e.value === "folder"
      case "and":
      case "or":       return e.exprs.some(hasFolderModifier)
      default:         return false
    }
  }
  return exprs.some(hasFolderModifier)
}

// Collects the modifier expressions of a given field from a query tree. Used by
// the UI to re-evaluate which rendered nodes satisfy e.g. an `in:` recency
// filter. Negation is deliberately not descended into: `-in:3m` means "not
// recent", which should not mark anything as a match.
export function collectModifiers(expr: QueryExpr, field: QueryModifierField): QueryExpr[] {
  switch (expr.type) {
    case "modifier": return expr.field === field ? [expr] : []
    case "and":
    case "or":       return expr.exprs.flatMap(e => collectModifiers(e, field))
    default:         return []
  }
}

// ── Archive reveal ──────────────────────────────────────────────────────────────
//
// `is:archived` / `:archived` is not an ordinary matcher — as a matcher it would
// mean "AND archived" (only-archived), but the intent is a *reveal toggle*: keep
// the normal results and additionally show archived items (greyed). So it is
// extracted from the query into a `reveal` flag and stripped from matching, with
// one degradation: a stage whose only content was the flag collapses to empty and
// is replaced by the archived predicate, so a bare `is:archived` still matches the
// archived items. `-is:archived` is a no-op (archived is hidden by default anyway).

const ARCHIVED = { type: "modifier", field: "is", value: "archived" } as const

function isArchivedModifier(expr: QueryExpr): boolean {
  return expr.type === "modifier" && expr.field === "is" && expr.value === "archived"
}

function stripArchived(expr: QueryExpr): { expr: QueryExpr; reveal: boolean } {
  switch (expr.type) {
    case "modifier":
      return isArchivedModifier(expr)
        ? { expr: { type: "empty" }, reveal: true }
        : { expr, reveal: false }
    case "not": {
      const inner = stripArchived(expr.expr)
      // `-is:archived` → drop it entirely and do NOT reveal (it just restates
      // the default of hiding archived).
      if (inner.expr.type === "empty") return { expr: { type: "empty" }, reveal: false }
      return { expr: { type: "not", expr: inner.expr }, reveal: inner.reveal }
    }
    case "and":
    case "or": {
      let reveal = false
      const kept: QueryExpr[] = []
      for (const e of expr.exprs) {
        const r = stripArchived(e)
        reveal ||= r.reveal
        if (r.expr.type !== "empty") kept.push(r.expr)
      }
      if (kept.length === 0) return { expr: { type: "empty" }, reveal }
      if (kept.length === 1) return { expr: kept[0], reveal }
      return { expr: { type: expr.type, exprs: kept }, reveal }
    }
    default:
      return { expr, reveal: false }
  }
}

export function extractArchiveReveal(stages: QueryExpr[]): { reveal: boolean; stages: QueryExpr[] } {
  let reveal = false
  const out = stages.map(stage => {
    const r = stripArchived(stage)
    reveal ||= r.reveal
    // A stage that contained *only* the flag collapses to empty — substitute the
    // archived predicate so `is:archived` (alone, or as a whole stage) matches.
    if (r.reveal && r.expr.type === "empty") return { ...ARCHIVED }
    return r.expr
  })
  return { reveal, stages: out }
}

// ── Outline / tree scope ────────────────────────────────────────────────────────
//
// `outline:<note>` / `:daily` is not a per-node matcher either: it restricts the
// whole search to one note's own outline (searchIndex). `[[note]]` restricts
// it to the note's full subtree: all edges the search would follow, from any
// file. Their targets are collected from anywhere in the query and the modifiers
// stripped, so the rest of each stage matches as usual; a stage holding only the
// scope collapses to empty (matches all). A negated `-outline:`/`-[[note]]` is
// dropped without scoping.

/** A note named by `outline:`/`[[note]]`: `exact` names it whole (quoted, `:daily`, or a link); otherwise `value` is a fragment. */
export type ScopeTarget = { value: string; exact: boolean }

type ScopeTargets = { outline: ScopeTarget[]; tree: ScopeTarget[] }

function stripScope(expr: QueryExpr, scopes: ScopeTargets, negated: boolean): QueryExpr {
  switch (expr.type) {
    case "modifier":
      if (expr.field !== "outline" && expr.field !== "tree") return expr
      if (!negated) scopes[expr.field].push({ value: expr.value, exact: expr.exact === true })
      return { type: "empty" }
    case "not": {
      const inner = stripScope(expr.expr, scopes, true)
      return inner.type === "empty" ? inner : { type: "not", expr: inner }
    }
    case "and":
    case "or": {
      const kept = expr.exprs.map(e => stripScope(e, scopes, negated)).filter(e => e.type !== "empty")
      if (kept.length === 0) return { type: "empty" }
      if (kept.length === 1) return kept[0]
      return { type: expr.type, exprs: kept }
    }
    default:
      return expr
  }
}

export function extractScope(stages: QueryExpr[]): { outline: ScopeTarget[]; tree: ScopeTarget[]; stages: QueryExpr[] } {
  const scopes: ScopeTargets = { outline: [], tree: [] }
  const out = stages.map(stage => stripScope(stage, scopes, false))
  return { ...scopes, stages: out }
}
