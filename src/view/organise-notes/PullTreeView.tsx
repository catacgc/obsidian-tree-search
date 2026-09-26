import React, { useEffect, useMemo, useRef, useState } from "react";
import { App, Component, MarkdownRenderer, Notice } from "obsidian";
import {
    NotesGraph,
    PullNode,
    formatOccurrenceDate,
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
// might find content the indexer skipped entirely.
function collectAnchorNodes(node: PullNode, out: PullNode[]): void {
    for (const child of node.children) {
        if (child.node.nodeType === "text" || child.node.nodeType === "page") out.push(child);
        collectAnchorNodes(child, out);
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

// Whether `node` or anything beneath it still needs to move - i.e. whether
// showing it (or recursing into it) could surface at least one row whose
// bullet doesn't already sit at its resolved destination. Mirrors the same
// isPage/childDestHome propagation `PullRow` uses below, so a node hidden
// here is exactly the set of nodes `PullRow` itself would render nothing
// for.
function subtreeHasMove(node: PullNode, destHome: OrganiseHome, homeOf: HomeLookup): boolean {
    if (node.node.location.path !== destHome.path) return true;
    const childDestHome = node.node.nodeType === "page" ? homeOf(node.key) : destHome;
    return node.children.some(child => subtreeHasMove(child, childDestHome, homeOf));
}

type Props = {
    app: App;
    graph: NotesGraph;
    root: PullNode;
    notePath: string;
    onApplied: () => void;
};

export function PullTreeView({ app, graph, root, notePath, onApplied }: Props) {
    const [checked, setChecked] = useState<Set<string>>(() => {
        const all = new Set<string>();
        collectDescendantKeys(root, all);
        return all;
    });

    // The anchor every root-level row's own line is filed under - the note
    // this pane was opened for, which always exists (mirrors `rootHome` in
    // `onConfirm` below and `planOrganiseWrites`'s root call).
    const rootHome: OrganiseHome = useMemo(() => ({ path: notePath, exists: true }), [notePath]);

    const homeOf: HomeLookup = useMemo(() => {
        const cache = new Map<string, OrganiseHome>();
        return (pageKey: string) => {
            if (!cache.has(pageKey)) cache.set(pageKey, resolveHome(app, graph, pageKey, notePath));
            return cache.get(pageKey)!;
        };
    }, [app, graph, notePath]);

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
        collectAnchorNodes(root, anchorNodes);
        Promise.all(anchorNodes.map(async n => [n.key, await collectUnindexedChildLines(app, n)] as const))
            .then(entries => {
                if (!cancelled) setExtraLines(new Map(entries.filter(([, lines]) => lines.length > 0)));
            })
            .catch(() => { /* best-effort - a failed read just means no extra lines for that node */ });
        return () => { cancelled = true; };
    }, [app, root]);

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

    function resetSelection(): void {
        const all = new Set<string>();
        collectDescendantKeys(root, all);
        setChecked(all);
    }

    async function onConfirm(): Promise<void> {
        const isChecked = (key: string) => checked.has(key);
        const extraLinesOf = (node: PullNode, depth: number): PullLine[] =>
            (extraLines.get(node.key) ?? []).map(l => ({ ...l, depth: l.depth + depth }));
        const writes = planOrganiseWrites(root, { path: notePath, exists: true }, isChecked, homeOf, extraLinesOf);
        const deletions = planDeletions(graph, root, isChecked);

        if (writes.length === 0) {
            new Notice("Nothing selected to organise");
            return;
        }

        await applyOrganisePlan(app, writes, deletions);
        const lineCount = writes.reduce((n, w) => n + w.children.length + w.mentions.length, 0);
        const homeCount = writes.length;
        new Notice(
            `Organised ${lineCount} line${lineCount === 1 ? "" : "s"} into ${homeCount} note${homeCount === 1 ? "" : "s"}, ` +
            `removed ${deletions.length} source line${deletions.length === 1 ? "" : "s"}`
        );
        onApplied();
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", maxHeight: "70vh", overflow: "auto" }}>
            <div
                style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "var(--size-4-2)",
                    padding: "var(--size-4-2)",
                    background: "var(--background-primary)",
                    borderBottom: "1px solid var(--background-modifier-border)",
                }}
            >
                <button onClick={resetSelection}>Select all</button>
                <button className="mod-cta" onClick={onConfirm}>Organise selected</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--size-4-1)", padding: "var(--size-4-1)" }}>
                <div className="setting-item-description">
                    Select what to organise. Each topic&apos;s own detail lines are filed into that topic&apos;s own note.
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                    {root.children.length === 0 && (
                        <div className="setting-item-description">Nothing to organise - this node has no children.</div>
                    )}
                    {root.children.length > 0 && !root.children.some(child => subtreeHasMove(child, rootHome, homeOf)) && (
                        <div className="setting-item-description">Nothing to organise - everything is already in its own note.</div>
                    )}
                    {root.children.map(child => (
                        <PullRow key={child.key} app={app} node={child} depth={0} checked={checked} onToggle={toggle} homeOf={homeOf} extraLines={extraLines} destHome={rootHome} />
                    ))}
                </div>
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

    return <span ref={ref} style={{ display: "inline" }} />;
}

function PullRow({ app, node, depth, checked, onToggle, homeOf, extraLines, destHome }: {
    app: App;
    node: PullNode;
    depth: number;
    checked: Set<string>;
    onToggle: (node: PullNode, value: boolean) => void;
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
    const moves = sourcePath !== destHome.path;
    const ownExtraLines = extraLines.get(node.key) ?? [];

    useEffect(() => {
        if (ref.current) ref.current.indeterminate = state === "partial";
    }, [state]);

    // A node whose own bullet already sits at its resolved destination is
    // already organised - it (and its own extra lines, which by definition
    // sit right alongside it in the same already-correct file) is hidden
    // entirely rather than shown as a no-op row. Its children are still
    // walked below, since a descendant can still need to move even when
    // this node itself doesn't.
    const visibleChildren = node.children.filter(child => subtreeHasMove(child, childDestHome, homeOf));

    return (
        <div>
            {moves && (
                <label
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--size-4-1)",
                        paddingTop: "1px",
                        paddingBottom: "1px",
                        paddingLeft: depth * 16,
                    }}
                >
                    <input
                        ref={ref}
                        type="checkbox"
                        checked={isChecked}
                        onChange={e => onToggle(node, e.target.checked)}
                    />
                    <MarkdownLine app={app} text={describeNode(node)} sourcePath={node.node.location.path} />
                    <button
                        type="button"
                        onClick={() => highlightLine(app, node.node.location)}
                        title={`Reveal source: ${sourcePath}`}
                        style={{
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            textDecoration: "underline",
                            color: "var(--text-muted)",
                            fontSize: "var(--font-ui-smaller)",
                            cursor: "pointer",
                        }}
                    >
                        source
                    </button>
                    <span
                        className="setting-item-description"
                        style={{ fontStyle: "italic", color: "var(--text-accent)", fontSize: "var(--font-ui-smaller)" }}
                        title={`${sourcePath} → ${destHome.exists ? "" : "(new) "}${destHome.path}`}
                    >
                        {basename(sourcePath)} → {destHome.exists ? "" : "(new) "}{basename(destHome.path)}
                    </span>
                </label>
            )}
            {moves && ownExtraLines.map((line, i) => (
                <div
                    key={i}
                    style={{
                        paddingLeft: (depth + line.depth) * 16,
                        color: "var(--text-faint)",
                        fontSize: "var(--font-ui-smaller)",
                    }}
                >
                    {line.text}
                </div>
            ))}
            {visibleChildren.map(child => (
                <PullRow key={child.key} app={app} node={child} depth={depth + 1} checked={checked} onToggle={onToggle} homeOf={homeOf} extraLines={extraLines} destHome={childDestHome} />
            ))}
        </div>
    );
}
