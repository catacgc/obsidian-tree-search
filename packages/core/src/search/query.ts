import type { ParsedNode } from "../graph/types.ts"

export type QueryModifier =
  | ":task"
  | ":emoji"
  | ":page"
  | ":header"
  | ":folder"
  | ":attachment"

const QUERY_MODIFIERS: QueryModifier[] = [
  ":task",
  ":emoji",
  ":page",
  ":header",
  ":folder",
  ":attachment",
]

export type QueryExpr =
  | { type: "contains"; value: string }
  | { type: "empty" }
  | { type: "equals"; value: string }
  | { type: "startsWith"; value: string }
  | { type: "not"; expr: QueryExpr }
  | { type: "and"; exprs: QueryExpr[] }
  | { type: "or"; exprs: QueryExpr[] }
  | { type: "modifier"; value: QueryModifier }

function tokenize(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0)
}

export function parseQuery(query: string): QueryExpr {
  if (!query.trim()) return { type: "empty" }
  return parseOrGroups(tokenize(query))
}

function parseOrGroups(tokens: string[]): QueryExpr {
  const groups = splitByOr(tokens)
  if (groups.length === 1) return parseAndGroup(groups[0])
  return { type: "or", exprs: groups.map(parseAndGroup) }
}

function parseAndGroup(tokens: string[]): QueryExpr {
  if (tokens.length === 1) return parseToken(tokens[0])
  return { type: "and", exprs: tokens.map(parseToken) }
}

function splitByOr(tokens: string[]): string[][] {
  const groups: string[][] = []
  let current: string[] = []
  for (const t of tokens) {
    if (t === "|") {
      if (current.length > 0) { groups.push(current); current = [] }
    } else {
      current.push(t)
    }
  }
  if (current.length > 0) groups.push(current)
  return groups
}

function parseToken(token: string): QueryExpr {
  if (token.startsWith(":")) {
    const mod = QUERY_MODIFIERS.find(m => m.startsWith(token))
    if (mod) return { type: "modifier", value: mod }
  }
  if (token.startsWith('"') && token.endsWith('"')) {
    return { type: "equals", value: token.slice(1, -1) }
  }
  if (token.startsWith('"')) {
    return { type: "startsWith", value: token.slice(1) }
  }
  if (token.startsWith("-")) {
    return { type: "not", expr: { type: "contains", value: token.slice(1) } }
  }
  return { type: "contains", value: token }
}

const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u

export function containsEmoji(text: string): boolean {
  return emojiRegex.test(text)
}

export function matchQuery(attrs: ParsedNode, expr: QueryExpr): boolean {
  switch (expr.type) {
    case "empty":
      return true
    case "contains":
      return attrs.searchKey.toLowerCase().includes(expr.value.toLowerCase())
    case "equals":
      return attrs.searchKey.toLowerCase() === expr.value.toLowerCase()
    case "startsWith":
      return attrs.searchKey.toLowerCase().startsWith(expr.value.toLowerCase())
    case "not":
      return !matchQuery(attrs, expr.expr)
    case "and":
      return expr.exprs.every(e => matchQuery(attrs, e))
    case "or":
      return expr.exprs.some(e => matchQuery(attrs, e))
    case "modifier":
      if (expr.value.startsWith(":t"))
        return attrs.nodeType === "text" && (attrs as { isTask?: boolean }).isTask === true
      if (expr.value.startsWith(":e")) return containsEmoji(attrs.searchKey)
      if (expr.value.startsWith(":p")) return attrs.nodeType === "page"
      if (expr.value.startsWith(":h")) return attrs.nodeType === "header"
      if (expr.value.startsWith(":f")) return attrs.nodeType === "folder"
      if (expr.value.startsWith(":a")) return attrs.nodeType === "attachment"
      return false
  }
}

export function firstPassInclude(attrs: ParsedNode, expr: QueryExpr): boolean {
  if (expr.type === "not") return !matchQuery(attrs, expr.expr)
  return matchQuery(attrs, expr)
}
