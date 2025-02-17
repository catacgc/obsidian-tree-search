import { reverseMarkdownParsing } from "src/copy";
import { TreeNode } from "../search/SearchViewFlatten";
import { ObsidianLinkToken, ParsedNode, ParsedTextToken } from "src/graph";

export interface VaultResults {
    vault: string;
    results: IndividualListItemModel[];
    error?: string;
}

export interface IndividualListItemModel {
    title: string,
    level: number,
    index: number,
    nodeType: string,
    actions: RaycastAction[]
}

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

/* ======= ABOVE IS THE RAYCAST RESPONSE MODEL ======= */

/** Icon.* values in the Raycast API */
const Icons = {
    pencil: "pencil-16",
    globe: "globe-01-16",
    blankDocument: "blank-document-16",
    bookmark: "bookmark-16",
    copy: "copy-clipboard-16"
}

export function createRaycastResponse(vault: string, results: TreeNode[]): VaultResults {
    return {
        vault: vault,
        results: results.map((result, index) => {
            const actions: RaycastAction[] = []
            
            const ret = {
                title: renderTitle(result, actions, vault),
                level: result.indent,   
                index: result.index,
                nodeType: result.node.nodeType,
                actions: actions
            }

            ret.actions = [...ret.actions, ...getDefaultActions(result, vault)]

            return ret;
    })
    }
}

function getDefaultActions(result: TreeNode, vault: string): RaycastAction[] {
    return [
        {
            type: "browse",
            url: getHighlightUrl(result.node.location, vault),
            title: `See in Obsidian`,
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
        }
    ]
}

function renderTitle(result: TreeNode, actions: RaycastAction[], vault: string): string {
    switch (result.node.nodeType) {
        case "page":
            return result.node.page;
        case "header":
            return `${result.node.page} > ${result.node.header}`;
        case "text": {
            return nodeRenderer(result.node.parsedTokens, actions, vault)
        };
    }
}

function getInsertUrl(item: TreeNode["node"]["location"], vault: string): string {
    const uri = `raycastaction=insert&vault=${vault}&filepath=${item.path}&sl=${item.position.start.line}&sc=${item.position.start.ch}&el=${item.position.end.line}&ec=${item.position.end.ch}`;
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
        case "text":
            let decorate = ""
            if (token.decoration == "code") {
                decorate = "📋 "
                actions.push(
                    {
                        type: "copy",
                        text: token.text.trim(),
                        title: `Copy ${token.text.trim()} to clipboard`,
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

        case "obsidian_link":
            const url = token.pageTarget + (token.headerName ? `#${token.headerName}` : "");
            actions.push(
                {
                    type: "browse",
                    url: getOpenUrl(token, vault),
                    title: `Open 🔹 ${url}`,
                    icon: Icons.blankDocument
                }
            );
            return  "🔹" + token.source + nodeRenderer(tokens.slice(1), actions, vault);
        case "link":
            actions.push(
                {
                    type: "browse",
                    url: token.href,
                    title: `Browse 🔗 ${token.content}`,
                    icon: Icons.globe
                }
            );
            return "🔗 " + token.content + nodeRenderer(tokens.slice(1), actions, vault);
        case "image":
            return "🖼️ " + token.src + nodeRenderer(tokens.slice(1), actions, vault);
    }
  }
  