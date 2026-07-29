import type { ParsedNode } from "../graph/types.ts"

export type QueryModifierField = "is" | "has" | "in"

export type QueryExpr =
  | { type: "contains"; value: string }
  | { type: "empty" }
  | { type: "equals"; value: string }
  | { type: "not"; expr: QueryExpr }
  | { type: "and"; exprs: QueryExpr[] }
  | { type: "or"; exprs: QueryExpr[] }
  | { type: "modifier"; field: QueryModifierField; value: string }

export const IS_VALUES = ["page", "header", "text", "folder", "attachment", "task"]
export const HAS_VALUES = ["emoji", "link", "page"]

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

const LEGACY_MODIFIERS: Record<string, { field: QueryModifierField; value: string }> = {
  page: { field: "is", value: "page" },
  header: { field: "is", value: "header" },
  folder: { field: "is", value: "folder" },
  attachment: { field: "is", value: "attachment" },
  task: { field: "is", value: "task" },
  emoji: { field: "has", value: "emoji" },
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

    // Bareword: read until whitespace or a delimiter. A '-' does not stop
    // this scan once started, so "well-known" stays one word — only a
    // fresh '-' at a token boundary (handled above) is ever an operator.
    let j = i
    let value = ""
    while (j < input.length && !/\s/.test(input[j]) && !isDelimiter(input[j])) {
      value += input[j]
      j++
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

function matchField(word: string): { field: QueryModifierField; value: string } | null {
  const m = /^(is|has|in):(.+)$/.exec(word)
  if (!m) return null
  const field = m[1] as QueryModifierField
  const typedValue = m[2]
  // `in:` values are open-ended durations, not an enum — keep the raw string
  // and validate it at match time via parseDuration.
  if (field === "in") return { field, value: typedValue }
  const values = field === "is" ? IS_VALUES : HAS_VALUES
  const resolved = resolveUniquePrefix(values, typedValue)
  return { field, value: resolved ?? typedValue }
}

function matchLegacyModifier(word: string): { field: QueryModifierField; value: string } | null {
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
    if (tok.kind === "word") {
      const field = matchField(tok.value)
      if (field) return { type: "modifier", field: field.field, value: field.value }
      const legacy = matchLegacyModifier(tok.value)
      if (legacy) return { type: "modifier", field: legacy.field, value: legacy.value }
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
      case "folder": return attrs.nodeType === "folder"
      case "attachment": return attrs.nodeType === "attachment"
      case "task": return attrs.nodeType === "text" && attrs.isTask === true
      default: return false
    }
  }
  if (field === "in") {
    // Emoji-bearing nodes are treated as always "fresh" and match any window.
    if (containsEmoji(attrs.searchKey)) return true
    const days = parseDuration(value)
    return days !== null && attrs.ageDays <= days
  }
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
