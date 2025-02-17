import { Token } from "markdown-it";
import { ParsedNode, ParsedTextToken, TextToken } from "./graph";

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
  
    // if (token.type == "inline" && token.children) {
    //   return reverseMarkdown(token.children);
    // }
  
    // if (token.type == "obsidian_link") {
    //   let fileName = token.content.split("|")[0];
    //   fileName = fileName.split("#")[0];
  
    //   return `[[${token.content}]]` + reverseMarkdown(tokens.slice(1))
    // }
  
    // if (token.type == "link_open") {
    //   const href = decodeURI(token.attrs?.[0]?.[1] || "#");
    //   const content = tokens[1]?.content;
  
  
    //   return (
    //     `[${content}](${href})` + reverseMarkdown(tokens.slice(2))
    //   );
    // }
  
    // if (token.type == "link_close") {
    //   return reverseMarkdown(tokens.slice(1));
    // }
  
    // if (token.type == "text") {
    //   if (token.content.trim().startsWith("http")) {
  
    //     return (
    //       token.content +
    //       reverseMarkdown(tokens.slice(1))
    //     );
    //   }
    //   return (
    //     token.content + reverseMarkdown(tokens.slice(1))
    //   );
    // }
  
    // if (token.type == "strong_open") {
    //   return (
    //     `*${token.content}*` + reverseMarkdown(tokens.slice(1))
    //   );
    // }
  
    // if (token.type == "strong_close") {
    //   return (
    //     token.content + reverseMarkdown(tokens.slice(1))
    //   );
    // }
  
    // if (token.type == "em_open") {
    //   return (
    //     token.content + reverseMarkdown(tokens.slice(1))
    //   );
    // }
  
    // if (token.type == "softbreak") {
    //   return (
    //     token.content + reverseMarkdown(tokens.slice(1))
    //   );
    // }
  
    // if (token.type == "s_open") {
    //   return (
    //     token.content + reverseMarkdown(tokens.slice(1))
    //   );
    // }
  
    // if (token.type == "image") {
    //   return (
    //     token.content +
    //     reverseMarkdown(tokens.slice(1))
    //   );
    // }
  
    // if (token.type == "code_inline") {
    //   return (
    //     `\`${token.content}\`` +
    //     reverseMarkdown(tokens.slice(1))
    //   );
    // }
  
    // // if (!token.type.includes("_close")) console.log("tokens not rendered: ", tokens)
  
    // return token.content + reverseMarkdown(tokens.slice(1));
  }