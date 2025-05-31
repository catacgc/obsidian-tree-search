import { ParsedNode, ParsedTextToken, TextToken } from "../graph";

/**
 * This function parses the tokens and returns the original markdown string
 * This is done to avoid storing all the original lines (doubling the memory usage)
 * Alternatively, we could copy from the original file
 */

export function reverseMarkdownParsing(node: ParsedNode): string {
    if (node.nodeType == "page") {
        return `[[${node.page}]]`
    }

    if (node.nodeType == "header") {
        return `[[${node.page}#${node.header}]]`
    }

    if (node.nodeType == "month") {
        return `[[${node.month}]]`
    }

    if (node.nodeType == "folder") {
      return `[[${node.path}]]`
    }

    return reverseMarkdown(node.parsedTokens)
}

function reverseMarkdown(tokens: ParsedTextToken[]): string {
        

    if (tokens.length == 0) return "";
  
    const token = tokens[0];

    function decorate(token: TextToken) {
      switch(token.decoration) {
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

    switch(token.tokenType) {
        case "text":
            return decorate(token) + reverseMarkdown(tokens.slice(1))
        case "obsidian_link":
            return token.source + reverseMarkdown(tokens.slice(1))
        case "link":
            return `[${token.content}](${token.href})` + reverseMarkdown(tokens.slice(1))
        case "image":
            return `![${token.alt}](${token.src})` + reverseMarkdown(tokens.slice(1))
    }
  
  }