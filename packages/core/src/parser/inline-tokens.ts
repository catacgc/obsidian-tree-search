import MarkdownIt from "markdown-it"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Token = any
import type { MetaActionToken, MetaMdtreeToken, ParsedTextToken } from "../graph/types.ts"

// Remove the query string (`?…`) from any http(s) URL in the text, keeping
// scheme/domain/path. Used to keep query-param noise out of search keys.
export function stripUrlQueryStrings(text: string): string {
  return text.replace(/https?:\/\/[^\s)]+/g, url => {
    const q = url.indexOf("?")
    return q === -1 ? url : url.slice(0, q)
  })
}

// ── markdown-it plugins ───────────────────────────────────────────────────────

function inlineHttpLinkPlugin(md: MarkdownIt): void {
  md.core.ruler.before("normalize", "transform-urls", state => {
    const urlRegex = /(^|\s)(https?:\/\/[^\s\])}>,]+)/gm
    state.src = state.src.replace(urlRegex, (match, space: string, url: string) => {
      if (space.endsWith("[") || space.endsWith("<")) return match
      return `${space}[${url}](${url})`
    })
  })
}

function obsidianLinkPlugin(md: MarkdownIt): void {
  md.inline.ruler.before("link", "obsidian-link", (state, silent) => {
    const max = state.posMax
    const start = state.pos

    if (start + 4 > max) return false
    if (state.src.charAt(start) !== "[" || state.src.charAt(start + 1) !== "[") return false

    let end = start + 2
    while (end < max) {
      if (state.src.charAt(end) === "]" && state.src.charAt(end + 1) === "]") break
      end++
    }
    if (end >= max) return false

    if (!silent) {
      const content = state.src.slice(start + 2, end)
      const token = state.push("obsidian_link", "a", 0)
      token.content = content
      token.meta = { embed: start > 0 && state.src.charAt(start - 1) === "!" }
    }
    state.pos = end + 2
    return true
  })

  md.renderer.rules["obsidian_link"] = (tokens, idx) => tokens[idx].content
}

// ── Token parser ──────────────────────────────────────────────────────────────

let _md: MarkdownIt | null = null

function getMd(): MarkdownIt {
  if (!_md) {
    _md = new MarkdownIt().use(obsidianLinkPlugin).use(inlineHttpLinkPlugin)
  }
  return _md
}

function resolveReference(ref: string): string {
  if (ref.includes("/")) return ref.split("/")[1]
  return ref
}

function parseTokenList(tokens: Token[]): ParsedTextToken[] {
  if (tokens.length === 0) return []
  const token = tokens[0]

  if (token.type === "inline" && token.children) {
    return parseTokenList(token.children)
  }

  if (token.type === "http_link") {
    const href = token.attrs?.[0]?.[1] ?? token.content
    return [{ tokenType: "link", href, content: token.content }, ...parseTokenList(tokens.slice(1))]
  }

  if (token.type === "obsidian_link") {
    const link = token.content
    const actualRef = `[[${link}]]`
    const [withHeader, alias] = link.split("|")
    const [fileName, headerName] = (withHeader ?? "").split("#")
    return [
      {
        tokenType: "obsidian_link",
        source: actualRef,
        pageTarget: resolveReference(fileName ?? ""),
        headerName,
        alias,
        ...(token.meta?.embed ? { embed: true as const } : {}),
      },
      ...parseTokenList(tokens.slice(1)),
    ]
  }

  if (token.type === "link_open") {
    const href = token.attrs?.[0]?.[1] ?? "#"
    const content = tokens[1]?.content
    return [{ tokenType: "link", href, content }, ...parseTokenList(tokens.slice(2))]
  }

  const decorationMap: Record<string, string> = {
    text: "none",
    strong_open: "bold",
    em_open: "italic",
    s_open: "strikethrough",
    code_inline: "code",
    softbreak: "none",
  }

  if (token.type in decorationMap) {
    return [
      {
        tokenType: "text",
        text: token.content,
        decoration: decorationMap[token.type] as ParsedTextToken extends { tokenType: "text" }
          ? ParsedTextToken["decoration"]
          : never,
      },
      ...parseTokenList(tokens.slice(1)),
    ]
  }

  if (token.type === "image") {
    return [
      {
        tokenType: "image",
        src: token.attrs?.[0]?.[1] ?? "",
        alt: token.content || token.attrs?.[1]?.[1] || "",
      },
      ...parseTokenList(tokens.slice(1)),
    ]
  }

  return parseTokenList(tokens.slice(1))
}

const META_ACTION_TRIPLE_RE =
  /\(meta-action-name::([^)]*)\)\(meta-action-url::([^)]*)\)(?:\(meta-action-icon::([^)]*)\))?/g
const META_MDTREE_RE = /\(meta-mdtree::\s*(\w+)\)/g

export function parseTokens(markdownString: string): ParsedTextToken[] {
  // Extract meta-action triples first, remove them from the string for markdown-it
  const metaActions: MetaActionToken[] = []
  let cleaned = markdownString.replace(META_ACTION_TRIPLE_RE, (_, name, url, icon) => {
    metaActions.push({ tokenType: "meta_action", name, url, icon: icon || undefined })
    return ""
  })

  // Extract meta-mdtree directives
  const metaMdtree: MetaMdtreeToken[] = []
  cleaned = cleaned.replace(META_MDTREE_RE, (_, directive) => {
    metaMdtree.push({ tokenType: "meta_mdtree", directive })
    return ""
  })

  const md = getMd()
  const tokens = md.parseInline(cleaned.trim(), {})
  return [...parseTokenList(tokens), ...metaActions, ...metaMdtree]
}
