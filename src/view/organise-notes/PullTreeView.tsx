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
} from "@mdtree/core";
import { applyOrganisePlan, highlightLine, resolveHome } from "../../obsidian-utils";

function collectDescendantKeys(node: PullNode, out: Set<string>): void {
    for (const child of node.children) {
        out.add(child.key);
        collectDescendantKeys(child, out);
    }
}

function describeNode(node: PullNode): string {
    const date = formatOccurrenceDate(node.node);
    return reverseMarkdownParsing(node.node) + (date ? ` ${date}` : "");
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

type Props = {
    app: App;
    graph: NotesGraph;
    root: PullNode;
    notePath: string;
    onApplied: (touchedPaths: string[]) => void;
};

export function PullTreeView({ app, graph, root, notePath, onApplied }: Props) {
    const [checked, setChecked] = useState<Set<string>>(() => {
        const all = new Set<string>();
        collectDescendantKeys(root, all);
        return all;
    });

    const homeOf: HomeLookup = useMemo(() => {
        const cache = new Map<string, OrganiseHome>();
        return (pageKey: string) => {
            if (!cache.has(pageKey)) cache.set(pageKey, resolveHome(app, graph, pageKey, notePath));
            return cache.get(pageKey)!;
        };
    }, [app, graph, notePath]);

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
        const writes = planOrganiseWrites(root, { path: notePath, exists: true }, isChecked, homeOf);
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
        onApplied(writes.map(w => w.home.path));
    }

    return (
        <div className="tw-reset flex flex-col gap-3 p-2 max-h-[70vh] overflow-auto">
            <div className="text-sm text-obs-base-60">
                Select what to organise. Each topic&apos;s own detail lines are filed into that topic&apos;s own note.
            </div>
            <div className="flex flex-col gap-0.5">
                {root.children.length === 0 && (
                    <div className="text-sm text-obs-base-60 italic">Nothing to organise - this node has no children.</div>
                )}
                {root.children.map(child => (
                    <PullRow key={child.key} app={app} node={child} depth={0} checked={checked} onToggle={toggle} homeOf={homeOf} />
                ))}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-obs-border">
                <button className="tw-reset" onClick={resetSelection}>Select all</button>
                <button className="tw-reset font-semibold" onClick={onConfirm}>Organise selected</button>
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

    return <span ref={ref} className="inline" />;
}

function PullRow({ app, node, depth, checked, onToggle, homeOf }: {
    app: App;
    node: PullNode;
    depth: number;
    checked: Set<string>;
    onToggle: (node: PullNode, value: boolean) => void;
    homeOf: HomeLookup;
}) {
    const ref = useRef<HTMLInputElement>(null);
    const isChecked = checked.has(node.key);
    const state = subtreeState(node, checked);
    const home = node.node.nodeType === "page" ? homeOf(node.key) : null;

    useEffect(() => {
        if (ref.current) ref.current.indeterminate = state === "partial";
    }, [state]);

    return (
        <div>
            <label className="flex items-center gap-2 py-0.5" style={{ paddingLeft: depth * 20 }}>
                <input
                    ref={ref}
                    type="checkbox"
                    checked={isChecked}
                    onChange={e => onToggle(node, e.target.checked)}
                />
                <MarkdownLine app={app} text={describeNode(node)} sourcePath={node.node.location.path} />
                <button
                    type="button"
                    className="tw-reset text-xs text-obs-base-40 underline"
                    onClick={() => highlightLine(app, node.node.location)}
                >
                    reveal source
                </button>
                {home && (
                    <span className="text-xs text-obs-accent italic">
                        → {home.exists ? "" : "(new) "}{home.path}
                    </span>
                )}
            </label>
            {node.children.map(child => (
                <PullRow key={child.key} app={app} node={child} depth={depth + 1} checked={checked} onToggle={onToggle} homeOf={homeOf} />
            ))}
        </div>
    );
}
