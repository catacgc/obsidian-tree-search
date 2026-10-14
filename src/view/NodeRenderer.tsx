import { highlightLine, openFileByName } from "../obsidian-utils";
import { triggerLinkPreview } from "./hover-preview";
import { ParsedNode, ParsedTextToken, Location, stripUrlQueryStrings } from "@mdtree/core";
import {useMolecule} from "bunshi/react";
import {GlobalAppMolecule} from "./react-context/state";
import {EditorMolecule} from "./editor/EditorMolecule";
import {useAtomValue, useSetAtom} from "jotai";
import React from "react";

export function highlightText(text: string, terms: string[]): React.ReactNode {
    if (terms.length === 0) return text
    const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const regex = new RegExp(`(${escaped.join('|')})`, 'gi')
    const parts = text.split(regex)
    return <>{parts.map((part, i) =>
        terms.some(t => part.toLowerCase() === t.toLowerCase())
            ? <mark key={i} className="suggestion-highlight">{part}</mark>
            : part
    )}</>
}

// Highlight a link's visible name. If the name itself matches a term, highlight
// the matching substrings; otherwise, if the (query-stripped) URL matches, the
// hit lives in the invisible href, so underline the whole name to signal it.
function renderLinkName(display: string, href: string, terms: string[]): React.ReactNode {
    if (terms.length === 0) return display
    const lower = display.toLowerCase()
    if (terms.some(t => lower.includes(t.toLowerCase()))) return highlightText(display, terms)
    const url = stripUrlQueryStrings(href).toLowerCase()
    if (terms.some(t => url.includes(t.toLowerCase())))
        return <mark className="suggestion-highlight">{display}</mark>
    return display
}

/** Click on a note link in a row: in views with editor mode the note's (or heading's) Patch view (openPatchViewAtom);
 *  with Mod held, elsewhere, or when that doesn't apply, the note in Obsidian. Prevents the default first, so the row's
 *  own click (select, second-click open) skips it. */
function useOpenNoteLink() {
    const {appAtom} = useMolecule(GlobalAppMolecule)
    const app = useAtomValue(appAtom)
    const {openPatchViewAtom} = useMolecule(EditorMolecule)
    const openPatchView = useSetAtom(openPatchViewAtom)
    return async (ev: React.MouseEvent, target: string, obsidianName: string = target) => {
        ev.preventDefault()
        if (!ev.metaKey && !ev.ctrlKey && await openPatchView(target)) return
        if (app) await openFileByName(app, obsidianName)
    }
}

export const BaseNodeRender = (
    props: { node: ParsedNode; matchTerms: string[] }
) => {
    const {appAtom} = useMolecule(GlobalAppMolecule)

    const app = useAtomValue(appAtom)
    const { matchTerms } = props

    const openNoteLink = useOpenNoteLink()

    async function openFile(name: string) {
        if (app == undefined) return
        await openFileByName(app, name)
    }

    // Cmd/Ctrl+hover over a link anchor previews the actual linked note.
    // stopPropagation keeps the row's location preview from also firing.
    function previewLink(ev: React.MouseEvent<HTMLAnchorElement>, linktext: string) {
        if (app == undefined) return
        ev.stopPropagation()
        triggerLinkPreview(app, ev.nativeEvent, ev.currentTarget, linktext)
    }

    switch (props.node.nodeType) {
        case "page":
            const page = props.node.page
            const isRef = props.node.isReference
            const aliases = props.node.aliases.join(", ")
            return <span className={isRef ? "is-unresolved" : ""}>
                <a className={"obsidian-link " + (isRef ? "cm-underline" : "")} href="#"
                   onMouseOver={ev => previewLink(ev, page)}
                   onClick={ev => void openNoteLink(ev, page)}>{highlightText(page, matchTerms)}{aliases ? <> ({highlightText(aliases, matchTerms)})</> : ""}</a>
            </span>
        case "header":
            return <span>{highlightText(`${props.node.page} > ${props.node.header}`, matchTerms)}</span>
        case "text":
            return <TextNodeRenderer parsedTokens={props.node.parsedTokens} matchTerms={matchTerms}/>
        case "month":
            return <span>{props.node.monthLiteral} {props.node.year}</span>
        case "folder":
            const folderNote = props.node.folderNote
            // In the hierarchy the nesting conveys the path, so show the basename.
            const folderLabel = props.node.name || props.node.path
            return <span>
                <a className={"obsidian-link "} href="#" onClick={async ev => {
                    await openFile(folderNote)
                    ev.preventDefault()
                }}>
                {highlightText(folderLabel, matchTerms)} 📂
                </a>
            </span>
        case "folderNote":
            const folderNoteName = props.node.folder.name
            const folderNotePage = props.node.page.page
            return <span>
                <a className="obsidian-link" href="#"
                   onMouseOver={ev => previewLink(ev, folderNotePage)}
                   onClick={ev => void openNoteLink(ev, folderNotePage)}>{highlightText(folderNoteName, matchTerms)}</a> 📂📄
            </span>
        case "pointer":
            return <span>⚠️ Pointer node should not be rendered</span>
        case "attachment":
            const attachmentName = props.node.name
            const attachmentAliases = props.node.aliases.join(", ")
            return <span className={""}>
                <a className={"obsidian-link "} href="#" onClick={async ev => {
                    await openFile(page)
                    ev.preventDefault()
                }
                }>{highlightText(attachmentName, matchTerms)}{attachmentAliases ? <> ({highlightText(attachmentAliases, matchTerms)})</> : ""}</a>
            </span>
    }
}

export const TextNodeRenderer = (props: { parsedTokens: ParsedTextToken[]; matchTerms: string[] }) => {
    const {appAtom} = useMolecule(GlobalAppMolecule)
    const app = useAtomValue(appAtom)
    const { matchTerms } = props
    const openNoteLink = useOpenNoteLink()

    if (props.parsedTokens.length == 0) return <></>
    const token = props.parsedTokens[0]
    const rest = <TextNodeRenderer parsedTokens={props.parsedTokens.slice(1)} matchTerms={matchTerms}/>

    switch (token.tokenType) {
        case "obsidian_link": {
            const display = (token.alias && !parseInt(token.alias)) ? token.alias : token.pageTarget
            const header = token.headerName ? ` > ${token.headerName.trim()}` : ""
            const linktext = token.pageTarget + (token.headerName ? `#${token.headerName.trim()}` : "")
            return <span>
                <a className={"obsidian-link"} href="#"
                   onMouseOver={ev => {
                       if (app == undefined) return
                       ev.stopPropagation()
                       triggerLinkPreview(app, ev.nativeEvent, ev.currentTarget, linktext)
                   }}
                   onClick={ev => void openNoteLink(ev, linktext, token.pageTarget)}>
                    {highlightText(display, matchTerms)}{header}
                </a>
                {rest}
            </span>
        }
        case "link":
            return <>
                <a className={"external-link"} href={token.href}>{renderLinkName(token.content ?? token.href, token.href, matchTerms)}</a>
                {rest}
            </>
        case "image":
            return <>
                <a href={token.src} target="_blank">{token.alt || token.src}</a>
                {rest}
            </>
        case "text": {
            const highlighted = highlightText(token.text, matchTerms)
            let decorated: React.ReactNode
            switch (token.decoration) {
                case "bold":        decorated = <b>{highlighted}</b>; break
                case "italic":      decorated = <i>{highlighted}</i>; break
                case "underline":   decorated = <u>{highlighted}</u>; break
                case "strikethrough": decorated = <s>{highlighted}</s>; break
                case "code":        decorated = <code className="code-block">{highlighted}</code>; break
                default:            decorated = highlighted; break
            }
            if ("location" in token) {
                const locatedToken = token as ParsedTextToken & { location: Location }
                return <>
                    <a href="#" className="cm-underline obsidian-link" onClick={async ev => {
                        await highlightLine(app, locatedToken.location)
                        ev.preventDefault()
                    }}> {decorated} </a>
                    {rest}
                </>
            }
            return <>{decorated}{rest}</>
        }
    }
}

