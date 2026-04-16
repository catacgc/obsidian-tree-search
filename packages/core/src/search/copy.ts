import type { ParsedNode, ParsedTextToken, TextToken } from "../graph/types.ts"

export function reverseMarkdownParsing(node: ParsedNode): string {
  switch (node.nodeType) {
    case "page":
      return `[[${node.page}]]`
    case "header":
      return `[[${node.page}#${node.header}]]`
    case "month":
      return `[[${node.month}]]`
    case "folder":
      return `[[${node.path}]]`
    case "attachment":
      return `[[${node.location.path}]]`
    case "folderNote":
      return `[[${node.page.page}]]`
    case "pointer":
      return "⚠️ Pointer node should not be copied"
    case "text":
      return reverseMarkdown(node.parsedTokens)
  }
}

function reverseMarkdown(tokens: ParsedTextToken[]): string {
  if (tokens.length === 0) return ""
  const token = tokens[0]
  const rest = reverseMarkdown(tokens.slice(1))

  switch (token.tokenType) {
    case "text":
      return decorate(token) + rest
    case "obsidian_link":
      return token.source + rest
    case "link":
      return `[${token.content}](${token.href})` + rest
    case "image":
      return `![${token.alt}](${token.src})` + rest
  }
}

function decorate(token: TextToken): string {
  switch (token.decoration) {
    case "bold":
      return `**${token.text}**`
    case "italic":
      return `*${token.text}*`
    case "code":
      return `\`${token.text}\``
    case "strikethrough":
      return `~~${token.text}~~`
    case "underline":
      return `__${token.text}__`
    case "none":
      return token.text
  }
}
