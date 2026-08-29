import React, { useEffect, useMemo, useRef, useState } from "react";
import { App, Notice } from "obsidian";
import {
    NotesGraph,
    PullNode,
    findExistingOccurrence,
    formatOccurrenceDate,
    planPullWrites,
    planDeletions,
    reverseMarkdownParsing,
    Location,
} from "@mdtree/core";
import { applyPullPlan } from "../../obsidian-utils";

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

type ExistingLookup = (key: string) => Location | null;

type Props = {
    app: App;
    graph: NotesGraph;
    root: PullNode;
    destinationPath: string;
    onDone: () => void;
};

export function PullTreeView({ app, graph, root, destinationPath, onDone }: Props) {
    const [checked, setChecked] = useState<Set<string>>(() => {
        const all = new Set<string>();
        collectDescendantKeys(root, all);
        return all;
    });

    const existingOf: ExistingLookup = useMemo(() => {
        const cache = new Map<string, Location | null>();
        return (key: string) => {
            if (!cache.has(key)) cache.set(key, findExistingOccurrence(graph, key, destinationPath));
            return cache.get(key) ?? null;
        };
    }, [graph, destinationPath]);

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

    async function onConfirm(): Promise<void> {
        const isChecked = (key: string) => checked.has(key);
        const writes = planPullWrites(root, isChecked, existingOf);
        const deletions = planDeletions(graph, root, isChecked);

        if (writes.length === 0) {
            new Notice("Nothing selected to pull");
            onDone();
            return;
        }

        await applyPullPlan(app, writes, deletions);
        const lineCount = writes.reduce((n, w) => n + w.lines.length, 0);
        new Notice(`Pulled ${lineCount} line${lineCount === 1 ? "" : "s"}, removed ${deletions.length} source line${deletions.length === 1 ? "" : "s"}`);
        onDone();
    }

    return (
        <div className="tw-reset flex flex-col gap-3 p-2 max-h-[70vh] overflow-auto">
            <div className="text-sm text-obs-base-60">
                Select what to pull into this note. Unchecking a node also excludes its children.
            </div>
            <div className="flex flex-col gap-0.5">
                {root.children.length === 0 && (
                    <div className="text-sm text-obs-base-60 italic">Nothing to pull - this node has no children.</div>
                )}
                {root.children.map(child => (
                    <PullRow key={child.key} node={child} depth={0} checked={checked} onToggle={toggle} existingOf={existingOf} />
                ))}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-obs-border">
                <button className="tw-reset" onClick={onDone}>Cancel</button>
                <button className="tw-reset font-semibold" onClick={onConfirm}>Pull selected</button>
            </div>
        </div>
    );
}

function PullRow({ node, depth, checked, onToggle, existingOf }: {
    node: PullNode;
    depth: number;
    checked: Set<string>;
    onToggle: (node: PullNode, value: boolean) => void;
    existingOf: ExistingLookup;
}) {
    const ref = useRef<HTMLInputElement>(null);
    const isChecked = checked.has(node.key);
    const state = subtreeState(node, checked);
    const existing = existingOf(node.key);

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
                <span className="text-sm">{describeNode(node)}</span>
                {existing && (
                    <span className="text-xs text-obs-accent italic">
                        already in this note (line {existing.position.start.line + 1})
                    </span>
                )}
            </label>
            {node.children.map(child => (
                <PullRow key={child.key} node={child} depth={depth + 1} checked={checked} onToggle={onToggle} existingOf={existingOf} />
            ))}
        </div>
    );
}
