import { Token } from "markdown-it";

/**
 * This function parses the tokens and returns the original markdown string
 * This is done to avoid storing all the original lines (doubling the memory usage)
 * Alternatively, we could copy from the original file
 */
export function reverseMarkdownParsing(
    tokens: Token[],
  ): string {
    if (tokens.length == 0) return "";
  
    const token = tokens[0];
  
    if (token.type == "inline" && token.children) {
      return reverseMarkdownParsing(token.children);
    }
  
    if (token.type == "obsidian_link") {
      let fileName = token.content.split("|")[0];
      fileName = fileName.split("#")[0];
  
      return `[[${token.content}]]` + reverseMarkdownParsing(tokens.slice(1))
    }
  
    if (token.type == "link_open") {
      const href = decodeURI(token.attrs?.[0]?.[1] || "#");
      const content = tokens[1]?.content;
  
  
      return (
        `[${content}](${href})` + reverseMarkdownParsing(tokens.slice(2))
      );
    }
  
    if (token.type == "link_close") {
      return reverseMarkdownParsing(tokens.slice(1));
    }
  
    if (token.type == "text") {
      if (token.content.trim().startsWith("http")) {
  
        return (
          token.content +
          reverseMarkdownParsing(tokens.slice(1))
        );
      }
      return (
        token.content + reverseMarkdownParsing(tokens.slice(1))
      );
    }
  
    if (token.type == "strong_open") {
      return (
        `*${token.content}*` + reverseMarkdownParsing(tokens.slice(1))
      );
    }
  
    if (token.type == "strong_close") {
      return (
        token.content + reverseMarkdownParsing(tokens.slice(1))
      );
    }
  
    if (token.type == "em_open") {
      return (
        token.content + reverseMarkdownParsing(tokens.slice(1))
      );
    }
  
    if (token.type == "softbreak") {
      return (
        token.content + reverseMarkdownParsing(tokens.slice(1))
      );
    }
  
    if (token.type == "s_open") {
      return (
        token.content + reverseMarkdownParsing(tokens.slice(1))
      );
    }
  
    if (token.type == "image") {
      return (
        token.content +
        reverseMarkdownParsing(tokens.slice(1))
      );
    }
  
    if (token.type == "code_inline") {
      return (
        `\`${token.content}\`` +
        reverseMarkdownParsing(tokens.slice(1))
      );
    }
  
    // if (!token.type.includes("_close")) console.log("tokens not rendered: ", tokens)
  
    return token.content + reverseMarkdownParsing(tokens.slice(1));
  }