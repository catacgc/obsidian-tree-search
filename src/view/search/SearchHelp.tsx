import React from "react";
import {useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {Platform} from "obsidian";
import {describeQuerySyntax} from "@mdtree/core";
import {SearchViewMolecule} from "../react-context/state";
import {EDITOR_KEYS, formatKey, isAvailable, SHORTCUTS, type KeySpec} from "./shortcuts";

// Zero-state panel shown when there are no results to render: an inline,
// click-to-insert cheat sheet for the query language, then the view's keyboard
// shortcuts. Concrete tokens (is:/has:/in:/legacy) are buttons that append
// themselves to the query; grammar patterns and free-text examples are static.
export const SearchHelp = () => {
    const {actualQueryAtom, appendQueryTokenAtom, allowEditing, allowTimeline} = useMolecule(SearchViewMolecule)
    const query = useAtomValue(actualQueryAtom)
    const appendToken = useSetAtom(appendQueryTokenAtom)

    const trimmed = query.trim()
    // Below the 3-char search minimum we treat the state as idle ("keep typing")
    // rather than a genuine miss, since searchIndex returns nothing regardless.
    const header = trimmed.length < 3 ? "Search syntax" : `No results for “${trimmed}”`

    const groups = describeQuerySyntax()
    const shortcutGroups = groupShortcuts(allowEditing, allowTimeline)

    return (
        <div className="tw-reset p-4 max-w-5xl text-obs-base-60">
            <div className="text-sm font-semibold mb-3 text-obs-base-100">{header}</div>

            {/* Single column on mobile, 3 compact columns on desktop (md ≥ 768px). */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-4">
                {groups.map(group => (
                    <section key={group.title}>
                        <div className="text-xs uppercase tracking-wide text-obs-base-40 mb-1">
                            {group.title}
                        </div>
                        <div className="flex flex-col gap-1">
                            {group.entries.map(entry => (
                                <SyntaxRow
                                    key={entry.syntax}
                                    syntax={entry.syntax}
                                    description={entry.description}
                                    onInsert={entry.insertText ? () => appendToken(entry.insertText!) : undefined}
                                />
                            ))}
                        </div>
                    </section>
                ))}
            </div>

            <div className="text-sm font-semibold mt-6 mb-3 text-obs-base-100">Shortcuts</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-4">
                {shortcutGroups.map(group => (
                    <section key={group.title}>
                        <div className="text-xs uppercase tracking-wide text-obs-base-40 mb-1">
                            {group.title}
                        </div>
                        <div className="flex flex-col gap-1">
                            {group.rows.map(row => (
                                <SyntaxRow key={row.description} syntax={row.keys} description={row.description}/>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
};

const formatKeys = (keys: KeySpec[]) => keys.map(k => formatKey(k, Platform.isMacOS)).join(" ")

/** Shortcut table rows grouped for display, limited to what this view offers. */
function groupShortcuts(allowEditing: boolean, allowTimeline: boolean): {title: string; rows: {keys: string; description: string}[]}[] {
    const groups: {title: string; rows: {keys: string; description: string}[]}[] = []
    for (const s of SHORTCUTS) {
        if (!isAvailable(s, {allowEditing, allowTimeline})) continue
        let group = groups.find(g => g.title === s.group)
        if (!group) groups.push(group = {title: s.group, rows: []})
        group.rows.push({keys: formatKeys(s.keys), description: s.description})
    }
    if (allowEditing) {
        groups.push({title: "In the editor", rows: EDITOR_KEYS.map(e => ({keys: formatKeys(e.keys), description: e.description}))})
    }
    return groups
}

type SyntaxRowProps = {
    syntax: string;
    description: string;
    onInsert?: () => void;
};

// All rows render as the same left-aligned div so clickable and illustrative
// entries line up. Interactive rows get click/keyboard handlers (a <button>
// would inherit Obsidian's centered, full-width button chrome).
const SyntaxRow = ({syntax, description, onInsert}: SyntaxRowProps) => {
    const clickable = !!onInsert;
    return (
        <div
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            title={clickable ? `Insert ${syntax}` : undefined}
            onClick={onInsert}
            onKeyDown={clickable ? (ev) => {
                if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onInsert!(); }
            } : undefined}
            className={`flex items-baseline gap-2 ${clickable ? "cursor-pointer group" : ""}`}
        >
            <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-obs-base-20 text-obs-base-100 whitespace-nowrap">
                {syntax}
            </code>
            <span className={`text-xs ${clickable ? "group-hover:text-obs-accent" : ""}`}>{description}</span>
        </div>
    );
};
