import type { TreeNode, ParsedTextToken, ObsidianLinkToken } from "@mdtree/core"
import { reverseMarkdownParsing, isArchived, rowDate } from "@mdtree/core"

// ── Response model (matches existing Raycast plugin contract) ─────────────────

export type VaultResults = {
  vault: string
  results: IndividualListItemModel[]
  archivedCount?: number
  error?: string
}

export type IndividualListItemModel = {
  title: string
  level: number
  index: number
  nodeType: string
  actions: RaycastAction[]
}

export type RaycastAction = CopyAction | BrowseAction

type BaseAction = {
  icon: string
  title: string
  shortcut?: { modifiers: string[]; key: string }
}

export type CopyAction = BaseAction & { type: "copy"; text: string }
export type BrowseAction = BaseAction & { type: "browse"; url: string }

// ── Icons ─────────────────────────────────────────────────────────────────────

const Icons = {
  pencil: "pencil-16",
  globe: "globe-01-16",
  blankDocument: "blank-document-16",
  copy: "copy-clipboard-16",
  bookmark: "bookmark-16",
}

// ── URL builders ──────────────────────────────────────────────────────────────

function highlightUrl(location: TreeNode["node"]["location"], vault: string): string {
  const { path, position } = location
  return obsidianUri(
    `raycastaction=highlight&vault=${vault}&filepath=${path}&sl=${position.start.line}&sc=${position.start.ch}&el=${position.end.line}&ec=${position.end.ch}`,
  )
}

function insertUrl(location: TreeNode["node"]["location"], vault: string): string {
  const { path, position } = location
  return obsidianUri(
    `raycastaction=insert&vault=${vault}&filepath=${path}&sl=${position.start.line}&sc=${position.start.ch}&el=${position.end.line}&ec=${position.end.ch}`,
  )
}

function openUrl(token: ObsidianLinkToken, vault: string): string {
  const target = token.pageTarget + (token.headerName ? `#${token.headerName}` : "")
  return obsidianUri(`raycastaction=open&vault=${vault}&filepath=${target}`)
}

function revealFolderUrl(folderPath: string, vault: string): string {
  return obsidianUri(`raycastaction=revealFolder&vault=${vault}&filepath=${folderPath}`)
}

function moveToFolderUrl(filePath: string, vault: string): string {
  return obsidianUri(`raycastaction=moveToFolder&vault=${vault}&filepath=${filePath}`)
}

function archiveUrl(location: TreeNode["node"]["location"], vault: string): string {
  const { path, position } = location
  return obsidianUri(
    `raycastaction=archive&vault=${vault}&filepath=${path}&sl=${position.start.line}&sc=${position.start.ch}&el=${position.end.line}&ec=${position.end.ch}`,
  )
}

function unarchiveUrl(location: TreeNode["node"]["location"], vault: string): string {
  const { path, position } = location
  return obsidianUri(
    `raycastaction=unarchive&vault=${vault}&filepath=${path}&sl=${position.start.line}&sc=${position.start.ch}&el=${position.end.line}&ec=${position.end.ch}`,
  )
}

function obsidianUri(params: string): string {
  return `obsidian://tree-search-uri?${encodeURI(params)}`
}

function truncate(s: string, max = 60): string {
  return s.length <= max ? s : s.slice(0, max - 3) + "..."
}

// ── Title renderer ────────────────────────────────────────────────────────────

function renderTitle(result: TreeNode, actions: RaycastAction[], vault: string): string {
  const node = result.node

  switch (node.nodeType) {
    case "page": {
      actions.push({
        type: "browse",
        url: openUrl({ tokenType: "obsidian_link", source: node.page, pageTarget: node.page }, vault),
        title: `Open ${node.page}`,
        icon: Icons.blankDocument,
        shortcut: { key: "enter", modifiers: [] },
      })
      return node.page
    }

    case "header": {
      actions.push({
        type: "browse",
        url: highlightUrl(node.location, vault),
        title: truncate(`Open ${node.page} > ${node.header}`),
        icon: Icons.blankDocument,
      })
      return `${node.page} > ${node.header}`
    }

    case "text": {
      return nodeRenderer(node.parsedTokens, actions, vault)
    }

    case "month":
      return node.monthLiteral

    case "folder": {
      actions.push({
        type: "browse",
        url: revealFolderUrl(node.location.path, vault),
        title: `Reveal Folder`,
        icon: Icons.blankDocument,
        shortcut: { modifiers: ["shift"], key: "enter" },
      })
      return `${node.path} 📂`
    }

    case "attachment":
      return `${node.name} 🖼️`

    case "folderNote":
      return `${node.folder.name} 📂📄`

    case "pointer":
      return "⚠️ Pointer node should not appear in results"
  }
}

function nodeRenderer(
  tokens: ParsedTextToken[],
  actions: RaycastAction[],
  vault: string,
): string {
  if (tokens.length === 0) return ""
  const token = tokens[0]

  switch (token.tokenType) {
    case "text": {
      let decorate = ""
      if (token.decoration === "code") {
        decorate = "📋 "
        actions.push({
          type: "copy",
          text: token.text.trim(),
          title: truncate(`Copy "${token.text.trim()}" to clipboard`),
          icon: Icons.copy,
        })
      }
      if (token.text.trim().startsWith("http")) {
        decorate = "🔗 "
        actions.push({
          type: "browse",
          url: token.text.trim(),
          title: truncate(`Browse 🔗 ${token.text.trim()}`),
          icon: Icons.globe,
        })
      }
      return decorate + token.text + nodeRenderer(tokens.slice(1), actions, vault)
    }

    case "obsidian_link": {
      const url = token.pageTarget + (token.headerName ? `#${token.headerName}` : "")
      actions.push({
        type: "browse",
        url: openUrl(token, vault),
        title: truncate(`Open 🔹 ${url}`),
        icon: Icons.blankDocument,
      })
      return "🔹" + token.source + nodeRenderer(tokens.slice(1), actions, vault)
    }

    case "link": {
      actions.push({
        type: "browse",
        url: token.href,
        title: truncate(`Browse 🔗 ${token.content ?? token.href}`),
        icon: Icons.globe,
      })
      return "🔗 " + (token.content ?? token.href) + nodeRenderer(tokens.slice(1), actions, vault)
    }

    case "image":
      return "🖼️ " + (token.alt ?? token.src) + nodeRenderer(tokens.slice(1), actions, vault)

    case "meta_action": {
      actions.push({
        type: "browse",
        url: token.url,
        title: truncate(token.name),
        icon: token.icon ?? Icons.globe,
      })
      return nodeRenderer(tokens.slice(1), actions, vault)
    }

    case "meta_mdtree":
      return nodeRenderer(tokens.slice(1), actions, vault)
  }
  return ""
}

// ── Default actions ───────────────────────────────────────────────────────────

function defaultActions(result: TreeNode, vault: string): RaycastAction[] {
  const node = result.node
  const isFolder = node.nodeType === "folder"
  const isFile = node.nodeType === "page"
  const isText = node.nodeType === "text"

  if (isFolder) {
    return [
      {
        type: "browse",
        url: revealFolderUrl(node.location.path, vault),
        title: "Reveal Folder",
        icon: Icons.blankDocument,
        shortcut: { modifiers: ["shift"], key: "enter" },
      },
    ]
  }

  const base: RaycastAction[] = [
    {
      type: "browse",
      url: highlightUrl(node.location, vault),
      title: "See in Obsidian",
      icon: Icons.blankDocument,
      shortcut: { modifiers: ["shift"], key: "enter" },
    },
    {
      type: "copy",
      text: reverseMarkdownParsing(node),
      title: "Copy Node",
      icon: Icons.copy,
      shortcut: { modifiers: ["ctrl"], key: "c" },
    },
    {
      type: "browse",
      url: insertUrl(node.location, vault),
      title: "Insert After",
      icon: Icons.pencil,
      shortcut: { modifiers: ["ctrl"], key: "i" },
    },
  ]

  if (isFile) {
    base.push({
      type: "browse",
      url: moveToFolderUrl(node.location.path, vault),
      title: "Move To",
      icon: Icons.pencil,
      shortcut: { modifiers: ["ctrl"], key: "m" },
    })
  }

  if (isText) {
    base.push(
      isArchived(node)
        ? {
            type: "browse",
            url: unarchiveUrl(node.location, vault),
            title: "Unarchive",
            icon: Icons.bookmark,
          }
        : {
            type: "browse",
            url: archiveUrl(node.location, vault),
            title: "Archive",
            icon: Icons.bookmark,
          },
    )
  }

  return base
}

// ── createVaultResults ────────────────────────────────────────────────────────

export function createVaultResults(vault: string, results: TreeNode[], archivedCount = 0): VaultResults {
  return {
    vault,
    results: results.map((result, index) => {
      const actions: RaycastAction[] = []
      const date = rowDate(result.node, result.node.ageDays)
      const title = renderTitle(result, actions, vault) + (date ? ` (${date.label})` : "")
      return {
        title,
        level: result.indent,
        index: result.index,
        nodeType: result.node.nodeType,
        actions: [...actions, ...defaultActions(result, vault)],
      }
    }),
    ...(archivedCount > 0 ? { archivedCount } : {}),
  }
}
