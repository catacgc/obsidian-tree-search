import { reverseMarkdownParsing } from "./copy";
import { TreeNode } from "./search/SearchViewFlatten";
import { ObsidianLinkToken, ParsedTextToken, archiveToggle, isArchived, Location, isUndated, rowDate, textSourceDate } from "@mdtree/core";
import {App} from "obsidian";
import {resolveThumbnail, stripDateAnnotations, timelineCrumbs, type FileUrl} from "./search/timeline-utils";

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
    /** Present only on timeline responses (`view=timeline`). */
    timeline?: TimelineRowInfo
}

export interface TimelineRowInfo {
    /** Row date ("Today", "3d", "2w", "5m", "2025") and its YYYY-MM-DD form; absent when undated. */
    date?: { label: string; absolute: string }
    /** Days since the row date; sort key when merging vaults. */
    ageDays: number
    /** The date is the containing file's creation date: the line itself has none. */
    fromFile: boolean
    /** Matched ancestors, else the in-note parent or the source note. */
    breadcrumb: string[]
    /** Emoji-boosted: sorted on top. */
    pinned: boolean
    archived: boolean
    /** http(s)/data URL, or an absolute path for vault images. */
    thumbnail?: string
}

export type RaycastAction = Copy | Browse | InsertLink

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
    keepOpen?: boolean
    location?: Location
}

export interface InsertLink extends BaseAction {
    type: "insertLink"
    text: string
}

/** The `raycastaction` of an obsidian://tree-search-uri browse action, else null (link actions may hold any URL text). */
export const raycastActionOf = (action: RaycastAction): string | null =>
    action.type === "browse" && action.url.startsWith("obsidian://tree-search-uri?")
        ? new URL(action.url).searchParams.get("raycastaction")
        : null

/** The note (`Name`) or heading (`Name#Heading`) an `raycastaction=open` action opens, else null: a page or header
 *  row's own Open, a text row's `Open 🔹 [[link]]`, a folder's folder note. Editable Search views open it in the
 *  outline editor instead of in Obsidian. */
export function openTargetOf(action: RaycastAction): string | null {
    if (raycastActionOf(action) !== "open" || action.type !== "browse") return null
    const url = new URL(action.url)
    const file = url.searchParams.get("filepath")
    if (!file) return null
    return url.hash.length > 1 ? `${file}#${decodeURIComponent(url.hash.slice(1))}` : file
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

/** Which surface the actions are for: Insert Link adds the plain-Enter insertLink action. */
export type NodeActionMode = "default" | "insertLink"

export function getTreeNodeActions(app: App, treeNode: TreeNode, mode: NodeActionMode = "default"): RaycastAction[] {
    // The synthetic "Archive (N items)" row stands for no note or line.
    if (treeNode.archiveRow) return []
    const vault = app.vault.getName()
    const actions: RaycastAction[] = []
    const title = renderTitle(treeNode, actions, app)
    void title

    const reordered = prioritizeWebLinks(actions)

    const defaults = getDefaultActions(app, treeNode, vault)
    let allActions = [...reordered, ...defaults]

    if (mode !== "default") {
        // Insert Link's insert-at-cursor owns plain Enter; demote any other.
        allActions = allActions.map(a =>
            a.shortcut?.key === "enter" && a.shortcut.modifiers.length === 0
                ? { ...a, shortcut: undefined }
                : a)
    }

    if (mode === "insertLink") {
        const wikilink = reverseMarkdownParsing(treeNode.node)
        const insertLink: RaycastAction = {
            type: "insertLink",
            text: wikilink,
            title: `Insert ${wikilink}`,
            icon: Icons.pencil,
            shortcut: { modifiers: [], key: "enter" },
        }
        allActions = [insertLink, ...allActions]
    }

    return allActions.map(action => ({
        ...action,
        title: truncateActionTitle(action.title)
    }))
}

export function createRaycastResponse(app: App, results: TreeNode[]): VaultResults {
    const vault = app.vault.getName()
    return {
        vault,
        results: results.map((result, index) => {
            const actions = getTreeNodeActions(app, result)
            const date = rowDate(result.node, result.node.ageDays)
            return {
                title: renderTitle(result, [], app) + (date ? ` (${date.label})` : ""),
                level: result.indent,
                index: result.index,
                nodeType: result.node.nodeType,
                actions
            }
        })
    }
}

export function createRaycastTimelineResponse(app: App, rows: TreeNode[], fileUrl: FileUrl): VaultResults {
    return {
        vault: app.vault.getName(),
        results: rows.map(row => {
            const sourceDate = textSourceDate(row.node)
            const ageDays = row.timeline?.ageDays ?? row.node.ageDays
            // The date is its own field; drop its in-text repeats from the title.
            const shown = sourceDate ? {...row, node: stripDateAnnotations(row.node, sourceDate)} : row
            return {
                title: renderTitle(shown, [], app),
                level: 0,
                index: row.index,
                nodeType: row.node.nodeType,
                actions: getTreeNodeActions(app, row),
                timeline: {
                    date: rowDate(row.node, ageDays) ?? undefined,
                    ageDays,
                    fromFile: isUndated(row.node.ageDays),
                    breadcrumb: timelineCrumbs(row),
                    pinned: row.timeline?.pinned ?? false,
                    archived: row.archived ?? false,
                    thumbnail: resolveThumbnail(app, row.node, fileUrl) ?? undefined,
                },
            }
        })
    }
}

export function prioritizeWebLinks(actions: RaycastAction[]): RaycastAction[] {
    const hasEnterShortcut = actions.some(a => a.shortcut?.key === "enter")
    const webLinks = actions.filter(a => a.type === "browse" && !a.url.startsWith("obsidian://"))
    if (webLinks.length === 0) return actions

    const rest = actions.filter(a => !(a.type === "browse" && !a.url.startsWith("obsidian://")))
    const reordered = [...webLinks, ...rest]

    if (!hasEnterShortcut) {
        reordered[0] = { ...reordered[0], shortcut: { key: "enter", modifiers: [] } }
    }

    return reordered
}

/** The plain-Enter action when it opens a web URL (the line's first web link, given Enter by prioritizeWebLinks), else null. */
export function webEnterAction(actions: RaycastAction[]): Browse | null {
    for (const a of actions) {
        if (a.type === "browse" && a.shortcut?.key === "enter" && a.shortcut.modifiers.length === 0 && !a.url.startsWith("obsidian://")) return a
    }
    return null
}

/** The page's own note, resolved as the link it is: a page shown as a child carries the location of
 *  the line relating it (e.g. `- [[Child]]` in its parent's note), not its own file. Null without a note. */
function pageNoteLocation(app: App, node: TreeNode["node"]): Location | null {
    if (node.nodeType !== "page") return null
    const file = app.metadataCache.getFirstLinkpathDest(node.page, node.location.path)
    return file ? {path: file.path, position: {start: {line: 0, ch: 0}, end: {line: 0, ch: 0}}} : null
}

function getDefaultActions(app: App, result: TreeNode, vault: string): RaycastAction[] {
    const isFolder = result.node.nodeType == "folder"
    const isText = result.node.nodeType == "text"
    const pageLoc = pageNoteLocation(app, result.node)
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

    const moveFolderAction: RaycastAction[] = pageLoc ? [{
        type: "browse",
        url: moveToFolder(pageLoc.path, vault),
        title: `Move To`,
        icon: Icons.pencil,
        shortcut: { modifiers: ["ctrl"], key: "m" }
    }] : []

    // Lines and headings carry the tag on their own line; one archived only through its note, heading or parent line
    // has no action (the tag lives there). A heading only seen as a `[[Note#Heading]]` link (indent -1) has no line.
    const lineRow = isText || (result.node.nodeType === "header" && result.node.indent > 0)
    const toggle = lineRow ? archiveToggle(result.node) : null
    const archiveAction: RaycastAction[] = toggle ? [
        toggle === "unarchive" ? {
            type: "browse",
            url: unarchiveUrl(result.node.location, vault),
            title: `Unarchive`,
            icon: Icons.bookmark,
            keepOpen: true,
            location: result.node.location
        } : {
            type: "browse",
            url: archiveUrl(result.node.location, vault),
            title: `Archive`,
            icon: Icons.bookmark,
            keepOpen: true,
            location: result.node.location
        }
    ] : pageLoc ? [
        isArchived(result.node) ? {
            type: "browse",
            url: unarchivePageUrl(pageLoc.path, vault),
            title: `Unarchive`,
            icon: Icons.bookmark,
            keepOpen: true,
            location: pageLoc
        } : {
            type: "browse",
            url: archivePageUrl(pageLoc.path, vault),
            title: `Archive`,
            icon: Icons.bookmark,
            keepOpen: true,
            location: pageLoc
        }
    ] : []

    const pullChildrenAction: RaycastAction[] = pageLoc ? [{
        type: "browse",
        url: pullChildrenUrl(pageLoc.path, vault),
        title: `Consolidate notes`,
        icon: Icons.pencil,
        shortcut: { modifiers: ["ctrl"], key: "p" }
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

    return [...defaults, ...moveFolderAction, ...archiveAction, ...pullChildrenAction]
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
                url: getOpenUrl({tokenType: "obsidian_link", source: result.node.page, pageTarget: result.node.page, headerName: result.node.header}, vault),
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

function archiveUrl(location: TreeNode["node"]["location"], vault: string): string {
    const uri = `raycastaction=archive&vault=${vault}&filepath=${location.path}&sl=${location.position.start.line}&sc=${location.position.start.ch}&el=${location.position.end.line}&ec=${location.position.end.ch}`;
    return `obsidian://tree-search-uri?${encodeURI(uri)}`;
}

function unarchiveUrl(location: TreeNode["node"]["location"], vault: string): string {
    const uri = `raycastaction=unarchive&vault=${vault}&filepath=${location.path}&sl=${location.position.start.line}&sc=${location.position.start.ch}&el=${location.position.end.line}&ec=${location.position.end.ch}`;
    return `obsidian://tree-search-uri?${encodeURI(uri)}`;
}

function archivePageUrl(path: string, vault: string): string {
    const uri = `raycastaction=archivePage&vault=${vault}&filepath=${path}`;
    return `obsidian://tree-search-uri?${encodeURI(uri)}`;
}

function unarchivePageUrl(path: string, vault: string): string {
    const uri = `raycastaction=unarchivePage&vault=${vault}&filepath=${path}`;
    return `obsidian://tree-search-uri?${encodeURI(uri)}`;
}

/** Consolidates the note at `notePath` (the page's own note) into itself. */
function pullChildrenUrl(notePath: string, vault: string): string {
    const uri = `raycastaction=pullChildren&vault=${vault}&filepath=${notePath}`;
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
