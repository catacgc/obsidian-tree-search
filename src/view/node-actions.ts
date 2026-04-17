import { reverseMarkdownParsing } from "./copy";
import { TreeNode } from "./search/SearchViewFlatten";
import { ObsidianLinkToken, ParsedTextToken } from "@mdtree/core";
import {App} from "obsidian";

export type RaycastAction = Copy | Browse

export type BaseAction = {
    icon: string
    title: string
    shortcut?: { modifiers: string[], key: string }
}

export interface Copy extends BaseAction {
    type: "copy"
    text: string
}

export interface Browse extends BaseAction {
    type: "browse"
    url: string
}

/** Icon.* values in the Raycast API */
const Icons = {
    pencil: "pencil-16",
    globe: "globe-01-16",
    blankDocument: "blank-document-16",
    bookmark: "bookmark-16",
    copy: "copy-clipboard-16"
}

/** Truncate action title to 80 characters max, adding "..." if longer */
function truncateActionTitle(title: string): string {
    if (title.length <= 60) {
        return title;
    }
    return title.substring(0, 57) + "...";
}

export function getTreeNodeActions(app: App, treeNode: TreeNode): RaycastAction[] {
    const vault = app.vault.getName()
    const actions: RaycastAction[] = []
    const title = renderTitle(treeNode, actions, app)
    void title
    const defaults = getDefaultActions(treeNode, vault)
    const allActions = [...actions, ...defaults]
    return allActions.map(action => ({
        ...action,
        title: truncateActionTitle(action.title)
    }))
}

function getDefaultActions(result: TreeNode, vault: string): RaycastAction[] {
    const isFolder = result.node.nodeType == "folder"
    const isFile = result.node.nodeType == "page"

    if (isFolder) {
        return [
            {
                type: "browse",
                url: revealFolder(result.node.location.path, vault),
                title: `Reveal Folder`,
                icon: Icons.blankDocument,
                shortcut: { modifiers: ["shift"], key: "enter" }
            }
        ]
    }

    const moveFolderAction: RaycastAction[] = (isFolder || isFile) ? [{
        type: "browse",
        url: moveToFolder(result.node.location.path, vault),
        title: `Move To`,
        icon: Icons.pencil,
        shortcut: { modifiers: ["ctrl"], key: "m" }
    }] : []

    const defaults: RaycastAction[] = [
        {
            type: "browse",
            url: isFolder ? revealFolder(result.node.location.path, vault) : getHighlightUrl(result.node.location, vault),
            title: isFolder ? `Reveal Folder` : `See in Obsidian`,
            icon: Icons.blankDocument,
            shortcut: { modifiers: ["shift"], key: "enter" }
        },
        {
            type: "copy",
            text: reverseMarkdownParsing(result.node),
            title: `Copy Node`,
            icon: Icons.copy,
            shortcut: { modifiers: ["ctrl"], key: "c" }
        },
        {
            type: "browse",
            url: getInsertUrl(result.node.location, vault),
            title: `Insert After`,
            icon: Icons.pencil,
            shortcut: { modifiers: ["ctrl"], key: "i" }
        }]

    return [...defaults, ...moveFolderAction]
}

function renderTitle(result: TreeNode, actions: RaycastAction[], app: App): string {
    const vault = app.vault.getName()

    switch (result.node.nodeType) {
        case "page":
            actions.push({
                type: "browse",
                url: getOpenUrl({tokenType: "obsidian_link", source: result.node.page, pageTarget: result.node.page}, vault),
                title: `Open ${result.node.page}`,
                icon: Icons.blankDocument,
                shortcut: { key: "enter", modifiers: [] }
            })
            return result.node.page;
        case "header":
            actions.push({
                type: "browse",
                url: getHighlightUrl(result.node.location, vault),
                title: `Open ${result.node.page} > ${result.node.header}`,
                icon: Icons.blankDocument
            })
            return `${result.node.page} > ${result.node.header}`;
        case "text": {
            return nodeRenderer(result.node.parsedTokens, actions, vault)
        }
        case "month": {
            return result.node.monthLiteral;
        }
        case "folder": {
            const folderNoteExists = app.vault.getFileByPath(result.node.folderNote) != null

            actions.push({
                type: "browse",
                url: getOpenUrl({tokenType: "obsidian_link", source: result.node.folderNote, pageTarget: result.node.folderNote}, vault),
                title: folderNoteExists ? `Open ${result.node.folderNote}` : `Create Folder Note ${result.node.folderNote}`,
                icon: Icons.blankDocument
            })

            return `${result.node.path} 📂`;
        }
        case "attachment": {
            return `${result.node.name} 🖼️`;
        }
        case "folderNote": {
            return `${result.node.folder.name} 📂📄`;
        }
        case "pointer": {
            return "⚠️ Pointer node should not appear in results";
        }
    }
}

function getInsertUrl(item: TreeNode["node"]["location"], vault: string): string {
    const uri = `raycastaction=insert&vault=${vault}&filepath=${item.path}&sl=${item.position.start.line}&sc=${item.position.start.ch}&el=${item.position.end.line}&ec=${item.position.end.ch}`;
    return `obsidian://tree-search-uri?${encodeURI(uri)}`;
}

function revealFolder(folderPath: string, vault: string): string {
    const uri = `raycastaction=revealFolder&vault=${vault}&filepath=${folderPath}`;
    return `obsidian://tree-search-uri?${encodeURI(uri)}`;
}

function moveToFolder(folderPath: string, vault: string): string {
    const uri = `raycastaction=moveToFolder&vault=${vault}&filepath=${folderPath}`;
    return `obsidian://tree-search-uri?${encodeURI(uri)}`;
}

function getHighlightUrl(item: TreeNode["node"]["location"], vault: string): string {
    const uri = `raycastaction=highlight&vault=${vault}&filepath=${item.path}&sl=${item.position.start.line}&sc=${item.position.start.ch}&el=${item.position.end.line}&ec=${item.position.end.ch}`;
    return `obsidian://tree-search-uri?${encodeURI(uri)}`;
}

function getOpenUrl(item: ObsidianLinkToken, vault: string): string {
    const target = item.pageTarget + (item.headerName ? `#${item.headerName}` : "")
    const uri = `raycastaction=open&vault=${vault}&filepath=${target}`;
    return `obsidian://tree-search-uri?${encodeURI(uri)}`;
}

function nodeRenderer(
    tokens: ParsedTextToken[],
    actions: RaycastAction[],
    vault: string
  ): string {

    if (tokens.length == 0) return "";

    const token = tokens[0];

    switch (token.tokenType) {
        case "text": {
            let decorate = ""
            if (token.decoration == "code") {
                decorate = "📋 "
                actions.push(
                    {
                        type: "copy",
                        text: token.text.trim(),
                        title: `Copy "${token.text.trim()}" to clipboard`,
                        icon: Icons.copy
                    }
                );
            }
            if (token.text.trim().startsWith("http")) {
                decorate = "🔗 "
                actions.push(
                    {
                        type: "browse",
                        url: token.text.trim(),
                        title: `Browse 🔗 ${token.text.trim()}`,
                        icon: Icons.globe
                    }
                );
            }
            return decorate + token.text + nodeRenderer(tokens.slice(1), actions, vault);
        }
        case "obsidian_link": {
            const url = token.pageTarget + (token.headerName ? `#${token.headerName}` : "");
            actions.push(
                {
                    type: "browse",
                    url: getOpenUrl(token, vault),
                    title: `Open 🔹 ${url}`,
                    icon: Icons.blankDocument
                }
            );
            return "🔹" + token.source + nodeRenderer(tokens.slice(1), actions, vault);
        }
        case "link":
            actions.push(
                {
                    type: "browse",
                    url: token.href,
                    title: `Browse 🔗 ${token.content ?? token.href}`,
                    icon: Icons.globe
                }
            );
            return "🔗 " + (token.content ?? token.href) + nodeRenderer(tokens.slice(1), actions, vault);
        case "image":
            return "🖼️ " + (token.alt || token.src) + nodeRenderer(tokens.slice(1), actions, vault);
        case "meta_action":
            actions.push({
                type: "browse",
                url: token.url,
                title: truncateActionTitle(token.name),
                icon: token.icon ?? Icons.globe
            });
            return nodeRenderer(tokens.slice(1), actions, vault);
    }
    return ""
  }
