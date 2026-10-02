import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { App, Component, MarkdownRenderer, Notice } from "obsidian";
import {
    NotesGraph,
    PullNode,
    formatOccurrenceDate,
    isFrontmatterRelation,
    planOrganiseWrites,
    planDeletions,
    reverseMarkdownParsing,
    type OrganiseHome,
    type PullLine,
} from "@mdtree/core";
import { applyOrganisePlan, collectUnindexedChildLines, highlightLine, resolveHome } from "../../obsidian-utils";

function collectDescendantKeys(node: PullNode, out: Set<string>): void {
    for (const child of node.children) {
        out.add(child.key);
        collectDescendantKeys(child, out);
    }
}

// Any node that can anchor unindexed plain-text sub-bullets in its source
// file: a "text" mention (`[[Joe]] meeting notes`) or a bare-link "page"
// reference (`[[Joe]]` alone) - both are places `collectUnindexedChildLines`
// might find content the indexer skipped entirely. A frontmatter-declared
// child is not a bullet at all (its location is the `---` delimiter), so it
// has no sub-bullets to collect.
function collectAnchorNodes(graph: NotesGraph, node: PullNode, out: PullNode[]): void {
    for (const child of node.children) {
        const type = child.node.nodeType;
        if (type === "text" || (type === "page" && !isFrontmatterRelation(graph, child))) out.push(child);
        collectAnchorNodes(graph, child, out);
    }
}

function describeNode(node: PullNode): string {
    const date = formatOccurrenceDate(node.node);
    return reverseMarkdownParsing(node.node) + (date ? ` ${date}` : "");
}

function basename(path: string): string {
    const i = path.lastIndexOf("/");
    return i === -1 ? path : path.slice(i + 1);
}

function noteName(path: string): string {
    return basename(path).replace(/\.md$/, "");
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

type SubtreeState = "all" | "none" | "partial";

function subtreeState(node: PullNode, checked: Set<string>): SubtreeState {
    let anyChecked = checked.has(node.key);
    let anyUnchecked = !checked.has(node.key);
    for (const child of node.children) {
        const state = subtreeState(child, checked);
        if (state !== "none") anyChecked = true;
        if (state !== "all") anyUnchecked = true;
    }
    if (anyChecked && !anyUnchecked) return "all";
    if (!anyChecked) return "none";
    return "partial";
}

type HomeLookup = (pageKey: string) => OrganiseHome;

// Whether `node`'s own line actually changes place: it lives somewhere other
// than its resolved destination, and isn't a frontmatter-declared relation
// (which `planOrganiseWrites`/`planDeletions` leave untouched).
function nodeMoves(graph: NotesGraph, node: PullNode, destHome: OrganiseHome): boolean {
    return node.node.location.path !== destHome.path && !isFrontmatterRelation(graph, node);
}

// Whether `node` or anything beneath it still needs to move - i.e. whether
// showing it (or recursing into it) could surface at least one row whose
// bullet doesn't already sit at its resolved destination. Mirrors the same
// isPage/childDestHome propagation `PullRow` uses below.
function subtreeHasMove(graph: NotesGraph, node: PullNode, destHome: OrganiseHome, homeOf: HomeLookup): boolean {
    if (nodeMoves(graph, node, destHome)) return true;
    const childDestHome = node.node.nodeType === "page" ? homeOf(node.key) : destHome;
    return node.children.some(child => subtreeHasMove(graph, child, childDestHome, homeOf));
}

type Props = {
    app: App;
    graph: NotesGraph;
    root: PullNode;
    notePath: string;
    onApplied: () => void;
};

export function PullTreeView({ app, graph, root, notePath, onApplied }: Props) {
    // The anchor every root-level row's own line is filed under - the note
    // this pane was opened for, which always exists (mirrors
    // `planOrganiseWrites`'s root call in `plan` below).
    const rootHome: OrganiseHome = useMemo(() => ({ path: notePath, exists: true }), [notePath]);

    const homeOf: HomeLookup = useMemo(() => {
        const cache = new Map<string, OrganiseHome>();
        return (pageKey: string) => {
            if (!cache.has(pageKey)) cache.set(pageKey, resolveHome(app, graph, pageKey, notePath));
            return cache.get(pageKey)!;
        };
    }, [app, graph, notePath]);

    // Every row that actually moves, with where its line lands. Rows that are
    // already in place are rendered as muted context without a checkbox, so
    // they never act either (`plan` filters them out) - "tidying" one into
    // its own note's managed section duplicated it whenever its nested lines
    // had to stay behind.
    const movingRows = useMemo(() => {
        const rows = new Map<string, OrganiseHome>();
        (function walk(node: PullNode, dest: OrganiseHome): void {
            for (const child of node.children) {
                if (nodeMoves(graph, child, dest)) rows.set(child.key, dest);
                walk(child, child.node.nodeType === "page" ? homeOf(child.key) : dest);
            }
        })(root, rootHome);
        return rows;
    }, [graph, root, rootHome, homeOf]);

    // Default selection: only rows that land in the note being consolidated.
    // Rows routed into a sub-topic's own note start unchecked - consolidating
    // a note shouldn't reorganise its sub-topics unless asked to. Inert
    // context keys stay selected so a parent's tri-state checkbox reflects
    // only real choices.
    function ownRowsSelection(): Set<string> {
        const keys = new Set<string>();
        collectDescendantKeys(root, keys);
        for (const [key, dest] of movingRows) if (dest.path !== rootHome.path) keys.delete(key);
        return keys;
    }

    const [checked, setChecked] = useState<Set<string>>(ownRowsSelection);
    // Rows whose children/extra lines are folded away. View-only: selection
    // and the plan ignore it. Empty = fully expanded.
    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

    // Plain-text sub-bullets the indexer skipped entirely (no link, tag, or
    // URL) never became PullNode children, so buildPullTree can't see them -
    // this reads them straight from each anchor's (mention or bare-link)
    // source file instead, once per tree build, keyed by the anchor's own
    // node key. Depths here are still relative to each node (see
    // collectUnindexedChildLines) until they're combined with a node's
    // actual depth, either for preview rendering below or inside onConfirm's
    // extraLinesOf.
    const [extraLines, setExtraLines] = useState<Map<string, PullLine[]>>(new Map());
    useEffect(() => {
        let cancelled = false;
        const anchorNodes: PullNode[] = [];
        collectAnchorNodes(graph, root, anchorNodes);
        Promise.all(anchorNodes.map(async n => [n.key, await collectUnindexedChildLines(app, n)] as const))
            .then(entries => {
                if (!cancelled) setExtraLines(new Map(entries.filter(([, lines]) => lines.length > 0)));
            })
            .catch(() => { /* best-effort - a failed read just means no extra lines for that node */ });
        return () => { cancelled = true; };
    }, [app, graph, root]);

    function toggle(node: PullNode, value: boolean): void {
        setChecked(prev => {
            const next = new Set(prev);
            const subtree = new Set<string>([node.key]);
            collectDescendantKeys(node, subtree);
            for (const key of subtree) {
                if (value) next.add(key);
                else next.delete(key);
            }
            return next;
        });
    }

    function selectAll(): void {
        const all = new Set<string>();
        collectDescendantKeys(root, all);
        setChecked(all);
    }

    function toggleCollapsed(key: string): void {
        setCollapsed(prev => {
            const next = new Set(prev);
            if (!next.delete(key)) next.add(key);
            return next;
        });
    }

    // Leaf keys in the set are inert: leaves render no chevron.
    function collapseAll(): void {
        const all = new Set<string>();
        collectDescendantKeys(root, all);
        setCollapsed(all);
    }

    // The exact plan the button applies, recomputed on every selection
    // change so the summary next to it always states what will happen.
    const plan = useMemo(() => {
        const isChecked = (key: string) => checked.has(key) && movingRows.has(key);
        const extraLinesOf = (node: PullNode, depth: number): PullLine[] =>
            (extraLines.get(node.key) ?? []).map(l => ({ ...l, depth: l.depth + depth }));
        const writes = planOrganiseWrites(graph, root, rootHome, isChecked, homeOf, extraLinesOf);
        const deletions = planDeletions(graph, root, isChecked);
        const lineCount = writes.reduce((n, w) => n + w.children.length + w.mentions.length, 0);
        const newNotes = writes.filter(w => !w.home.exists).length;
        return { writes, deletions, lineCount, newNotes };
    }, [graph, root, rootHome, checked, movingRows, homeOf, extraLines]);

    async function onConfirm(): Promise<void> {
        const { writes, deletions, lineCount } = plan;
        if (writes.length === 0) {
            new Notice("Nothing selected to consolidate");
            return;
        }

        await applyOrganisePlan(app, writes, deletions);
        new Notice(
            `Consolidated ${plural(lineCount, "line")} into ${plural(writes.length, "note")}, ` +
            `removed ${plural(deletions.length, "source line")}`
        );
        onApplied();
    }

    const topic = reverseMarkdownParsing(root.node);
    const topicIsNote = root.node.nodeType === "page" && root.node.page.toLowerCase() === noteName(notePath).toLowerCase();
    const hasMoves = root.children.some(child => subtreeHasMove(graph, child, rootHome, homeOf));

    return (
        <div style={{ display: "flex", flexDirection: "column", maxHeight: "100%", overflow: "auto" }}>
            <div
                style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--size-4-2)",
                    padding: "var(--size-4-2)",
                    background: "var(--background-primary)",
                    borderBottom: "1px solid var(--background-modifier-border)",
                }}
            >
                <div>
                    <div style={{ fontSize: "var(--font-ui-medium)", fontWeight: "var(--font-semibold)" }}>
                        Consolidating into{" "}
                        <a
                            className="internal-link"
                            title={notePath}
                            onClick={() => app.workspace.openLinkText(notePath, "", false)}
                        >
                            {noteName(notePath)}
                        </a>
                    </div>
                    <div className="setting-item-description">
                        {topicIsNote
                            ? <>Everything nested under or mentioning <b>{topic}</b> across the vault.</>
                            : <>Everything nested under or mentioning <b>{topic}</b>, gathered into <b>{basename(notePath)}</b>.</>}
                    </div>
                </div>
                {hasMoves && (
                    <ul className="setting-item-description" style={{ margin: 0, paddingLeft: "var(--size-4-4)" }}>
                        <li>Each checked line moves to the note shown after <b>→</b> and is removed from the note it came from.</li>
                        <li>Lines headed for a sub-topic&apos;s own note start unchecked; check them to tidy that sub-topic too.</li>
                        <li>Topic links go into a list at the top of the note; mentions keep their date. Muted rows are only context.</li>
                    </ul>
                )}
                {hasMoves && (
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--size-4-2)" }}>
                        <span className="setting-item-description" style={{ flex: "1 1 12em" }}>
                            {plan.lineCount === 0
                                ? "Nothing selected."
                                : `${plural(plan.lineCount, "line")} into ${plural(plan.writes.length, "note")}` +
                                  (plan.newNotes > 0 ? ` (${plan.newNotes} new)` : "") +
                                  `, ${plural(plan.deletions.length, "source line")} removed`}
                        </span>
                        <button onClick={collapseAll}>Collapse all</button>
                        <button onClick={() => setCollapsed(new Set())}>Expand all</button>
                        <button onClick={() => setChecked(ownRowsSelection())}>Only into {noteName(notePath)}</button>
                        <button onClick={selectAll}>Select all</button>
                        <button className="mod-cta" disabled={plan.lineCount === 0} onClick={onConfirm}>
                            Consolidate
                        </button>
                    </div>
                )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", padding: "var(--size-4-1)" }}>
                {root.children.length === 0 && (
                    <div className="setting-item-description">Nothing to consolidate: nothing is nested under or mentions {topic}.</div>
                )}
                {root.children.length > 0 && !hasMoves && (
                    <div className="setting-item-description">Nothing to consolidate: everything is already in its own note.</div>
                )}
                {root.children.filter(child => subtreeHasMove(graph, child, rootHome, homeOf)).map(child => (
                    <PullRow key={child.key} app={app} graph={graph} node={child} depth={0} checked={checked} onToggle={toggle} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} homeOf={homeOf} extraLines={extraLines} destHome={rootHome} />
                ))}
            </div>
        </div>
    );
}

function MarkdownLine({ app, text, sourcePath }: { app: App; text: string; sourcePath: string }) {
    const ref = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const component = new Component();
        component.load();
        el.empty();
        MarkdownRenderer.render(app, text, el, sourcePath, component).catch(() => { /* best-effort render */ });
        return () => component.unload();
    }, [app, text, sourcePath]);

    return <span ref={ref} className="ts-pull-line" />;
}

const linkButtonStyle: React.CSSProperties = {
    background: "transparent",
    border: "none",
    boxShadow: "none",
    padding: 0,
    height: "auto",
    textDecoration: "underline",
    color: "var(--text-muted)",
    fontSize: "var(--font-ui-smaller)",
    cursor: "pointer",
};

function PullRow({ app, graph, node, depth, checked, onToggle, collapsed, onToggleCollapsed, homeOf, extraLines, destHome }: {
    app: App;
    graph: NotesGraph;
    node: PullNode;
    depth: number;
    checked: Set<string>;
    onToggle: (node: PullNode, value: boolean) => void;
    collapsed: Set<string>;
    onToggleCollapsed: (key: string) => void;
    homeOf: HomeLookup;
    extraLines: Map<string, PullLine[]>;
    // Where THIS node's own line lands, matching `planOrganiseWrites`'s
    // `homeThunk()` at the point this node is visited - the nearest page
    // ancestor's resolved home, or `rootHome` if there is none. A page
    // node's own children get a *different* anchor (that page's own
    // resolved home, `homeOf(node.key)`) below, since a page's content
    // moves into its own note even though the page-link bullet itself
    // stays with its parent's anchor.
    destHome: OrganiseHome;
}) {
    const ref = useRef<HTMLInputElement>(null);
    const isChecked = checked.has(node.key);
    const state = subtreeState(node, checked);
    const isPage = node.node.nodeType === "page";
    const childDestHome = isPage ? homeOf(node.key) : destHome;
    const sourcePath = node.node.location.path;
    const moves = nodeMoves(graph, node, destHome);
    const ownExtraLines = extraLines.get(node.key) ?? [];

    useEffect(() => {
        if (ref.current) ref.current.indeterminate = state === "partial";
    }, [state]);

    // Only descendants that still need to move (or lead to one) are shown.
    // A node that doesn't move itself but has such descendants is rendered as
    // a muted, checkbox-less context row so its children aren't orphaned.
    const visibleChildren = node.children.filter(child => subtreeHasMove(graph, child, childDestHome, homeOf));
    const shownExtraLines = moves ? ownExtraLines : [];
    const hasContent = visibleChildren.length > 0 || shownExtraLines.length > 0;
    const isCollapsed = hasContent && collapsed.has(node.key);

    // preventDefault: the button sits inside the moving row's <label>, so a
    // click would otherwise also toggle the checkbox.
    const collapseToggle = hasContent ? (
        <button
            type="button"
            className="clickable-icon ts-pull-toggle"
            aria-label={isCollapsed ? "Expand" : "Collapse"}
            aria-expanded={!isCollapsed}
            onClick={e => { e.preventDefault(); onToggleCollapsed(node.key); }}
        >
            <ChevronRight size={14} className={isCollapsed ? "" : "is-expanded"} />
        </button>
    ) : <span className="ts-pull-toggle" aria-hidden="true" />;

    return (
        <div>
            {moves ? (
                <label className="ts-pull-row" style={{ paddingLeft: depth * 16 }}>
                    {collapseToggle}
                    <input
                        ref={ref}
                        type="checkbox"
                        checked={isChecked}
                        onChange={e => onToggle(node, e.target.checked)}
                    />
                    <span className="ts-pull-body">
                        <span className="ts-pull-text">
                            <MarkdownLine app={app} text={describeNode(node)} sourcePath={sourcePath} />
                        </span>
                        <span className="ts-pull-meta" title={`Moves from ${sourcePath} to ${destHome.path}${destHome.exists ? "" : " (new note)"}`}>
                            <button
                                type="button"
                                onClick={e => { e.preventDefault(); highlightLine(app, node.node.location); }}
                                title={`Reveal in ${sourcePath}`}
                                style={linkButtonStyle}
                            >
                                {noteName(sourcePath)}
                            </button>
                            {" → "}
                            <span style={{ color: "var(--text-accent)" }}>{noteName(destHome.path)}</span>
                            {!destHome.exists && <span style={{ fontStyle: "italic" }}> (new note)</span>}
                        </span>
                    </span>
                </label>
            ) : (
                <div className="ts-pull-row" style={{ paddingLeft: depth * 16, color: "var(--text-faint)" }}>
                    {collapseToggle}
                    <span className="ts-pull-body">
                        <span className="ts-pull-text">
                            <MarkdownLine app={app} text={describeNode(node)} sourcePath={sourcePath} />
                        </span>
                        <span className="ts-pull-meta">
                            {isFrontmatterRelation(graph, node)
                                ? `parent set in ${noteName(sourcePath)} frontmatter`
                                : `already in ${noteName(sourcePath)}`}
                        </span>
                    </span>
                </div>
            )}
            {!isCollapsed && shownExtraLines.map((line, i) => (
                <div
                    key={i}
                    style={{
                        paddingLeft: (depth + line.depth) * 16,
                        color: "var(--text-faint)",
                        fontSize: "var(--font-ui-smaller)",
                        lineHeight: "var(--line-height-tight)",
                    }}
                >
                    {line.text}
                </div>
            ))}
            {!isCollapsed && visibleChildren.map(child => (
                <PullRow key={child.key} app={app} graph={graph} node={child} depth={depth + 1} checked={checked} onToggle={onToggle} collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} homeOf={homeOf} extraLines={extraLines} destHome={childDestHome} />
            ))}
        </div>
    );
}
