import type { ParsedNode } from "../graph/types.ts"

export type QueryModifierField = "is" | "has"

export type QueryExpr =
  | { type: "contains"; value: string }
  | { type: "empty" }
  | { type: "equals"; value: string }
  | { type: "not"; expr: QueryExpr }
  | { type: "and"; exprs: QueryExpr[] }
  | { type: "or"; exprs: QueryExpr[] }
  | { type: "modifier"; field: QueryModifierField; value: string }

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
  const m = /^(is|has):(.+)$/.exec(word)
  if (!m) return null
  return { field: m[1] as QueryModifierField, value: m[2] }
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
      return { type: "not", expr: parseAtom() }
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
  // field === "has"
  switch (value) {
    case "emoji": return containsEmoji(attrs.searchKey)
    case "link":
      return attrs.nodeType === "text" &&
        attrs.parsedTokens.some(t => t.tokenType === "obsidian_link" || t.tokenType === "link")
    case "page":
      return attrs.nodeType === "text" &&
        attrs.parsedTokens.some(t => t.tokenType === "obsidian_link")
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
