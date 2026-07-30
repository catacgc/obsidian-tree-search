import {App, stripHeadingForLink} from "obsidian";
import {Location} from "@mdtree/core";

/**
 * Hover-link source id. Must match the id passed to `registerHoverLinkSource`
 * in main.ts and the SEARCH_VIEW type, so Page Preview looks up the right
 * source (and its `defaultMod` mod-key gating) for our triggers.
 */
export const HOVER_SOURCE_ID = "tree-search";

// A shared hover parent. Page Preview owns popover dismissal on mouse-out, so a
// lightweight parent is sufficient here.
const hoverParent = {hoverPopover: null};

/**
 * Fire Obsidian's native Page Preview for a wikilink target (the actual note),
 * optionally scrolled to a `#header` encoded in `linktext`.
 */
export function triggerLinkPreview(
    app: App,
    event: MouseEvent,
    targetEl: HTMLElement,
    linktext: string,
    sourcePath = "",
) {
    app.workspace.trigger("hover-link", {
        event,
        source: HOVER_SOURCE_ID,
        hoverParent,
        targetEl,
        linktext,
        sourcePath,
    });
}

/**
 * Fire Page Preview for the location where a relation was recorded: the file at
 * `location.path`, scrolled to the node's section. Canvas-backed nodes are
 * skipped — native preview can't target a canvas node.
 *
 * Preview providers (core Page Preview, Hover Editor) derive the scroll target
 * from a subpath (`#heading` / `#^block`) parsed out of the linktext — they do
 * NOT honor an arbitrary line number. Obsidian has no raw-line anchor, so we
 * append the nearest enclosing heading as the subpath. `state.scroll` is also
 * passed for providers that honor it; those that don't simply ignore it.
 */
export function triggerLocationPreview(
    app: App,
    event: MouseEvent,
    targetEl: HTMLElement,
    location: Location,
) {
    if (location.canvasNode) return;
    const subpath = nearestHeadingSubpath(app, location);
    app.workspace.trigger("hover-link", {
        event,
        source: HOVER_SOURCE_ID,
        hoverParent,
        targetEl,
        linktext: location.path + subpath,
        sourcePath: location.path,
        state: {scroll: location.position.start.line},
    });
}

/**
 * Build a `#heading` subpath for the heading that most closely encloses the
 * node's line, or "" when the node sits above the first heading.
 */
function nearestHeadingSubpath(app: App, location: Location): string {
    const file = app.vault.getFileByPath(location.path);
    if (!file) return "";
    const headings = app.metadataCache.getFileCache(file)?.headings;
    if (!headings || headings.length === 0) return "";

    const line = location.position.start.line;
    let nearest: (typeof headings)[number] | undefined;
    for (const heading of headings) {
        if (heading.position.start.line <= line) nearest = heading;
        else break;
    }
    return nearest ? `#${stripHeadingForLink(nearest.heading)}` : "";
}
