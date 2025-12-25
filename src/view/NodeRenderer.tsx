import { highlightLine, openFileByName } from "../obsidian-utils";
import { ParsedNode, ParsedTextToken, TextTokenWithLocationLink } from "src/graph";
import { useMolecule } from "bunshi/react";
import { SearchViewMolecule, GlobalSearchMolecule } from "./react-context/state";
import { GlobalAppMolecule } from "./react-context/global";
import { useAtomValue } from "jotai";

export const NodeRenderer = (
    props: { node: ParsedNode }
) => {

    return <>
        <BaseNodeRender {...props} />
        {/* <span> ({props.node.ageDays} days ago) </span> */}
        {/* <span> ({props.node.boost} days ago) </span> */}
    </>
}


const BaseNodeRender = (
    props: { node: ParsedNode }
) => {
    const { appAtom } = useMolecule(GlobalAppMolecule)

    const app = useAtomValue(appAtom)

    async function openFile(name: string) {
        if (app == undefined) return
        await openFileByName(app, name)
    }

    switch (props.node.nodeType) {
        case "page":
            const page = props.node.page
            const isRef = props.node.isReference
            const aliases = props.node.aliases.join(",")
            return <span className={isRef ? "is-unresolved" : ""}>
                <a className={"obsidian-link " + (isRef ? "cm-underline" : "")} href="#" onClick={async ev => {
                    await openFile(page)
                    ev.preventDefault()
                }
                }>{page}{aliases ? ` (${aliases})` : ""}</a>
            </span>
        case "header":
            return <span>{`${props.node.page} > ${props.node.header}`}</span>
        case "text":
            return <TextNodeRenderer parsedTokens={props.node.parsedTokens} />
        case "month":
            return <span>{props.node.monthLiteral} {props.node.year}</span>
        case "folder":
            const folderNote = props.node.folderNote
            return <span>
                <a className={"obsidian-link "} href="#" onClick={async ev => {
                    await openFile(folderNote)
                    ev.preventDefault()
                }}>
                    📂 {props.node.path}
                </a>
            </span>
        case "folderNote":
            return <span>
                <a className="obsidian-link" href="#" onClick={async ev => {
                    await openFile((props.node as any).page.page)
                    ev.preventDefault()
                }
                }>{(props.node as any).folder.name}</a> 📂📄
            </span>
        case "pointer":
            // Pointer nodes should not be rendered directly - they should be resolved first
            return <span>⚠️ Pointer node should not be rendered</span>
        case "attachment":
            const attachmentName = props.node.name
            const attachmentAliases = props.node.aliases.join(",")
            return <span className={""}>
                <a className={"obsidian-link "} href="#" onClick={async ev => {
                    await openFile(page)
                    ev.preventDefault()
                }
                }>{attachmentName}{attachmentAliases ? ` (${attachmentAliases})` : ""}</a>
            </span>
    }
}

export const TextNodeRenderer = (props: { parsedTokens: ParsedTextToken[] }) => {
    const { appAtom } = useMolecule(GlobalAppMolecule)
    const app = useAtomValue(appAtom)

    async function openFile(name: string) {
        if (app == undefined) return
        await openFileByName(app, name)
    }

    if (props.parsedTokens.length == 0) return <></>
    const token = props.parsedTokens[0]

    switch (token.tokenType) {
        case "obsidian_link":
            return <span>
                <a className={"obsidian-link " + (false ? "cm-underline" : "")} href="#" onClick={async ev => {
                    await openFile(token.pageTarget)
                    ev.preventDefault()
                }}>
                    {(token.alias && !parseInt(token.alias)) ? token.alias : token.pageTarget}
                    {token.headerName ? ` > ${token.headerName.trim()}` : ""}
                </a>
                <TextNodeRenderer parsedTokens={props.parsedTokens.slice(1)} />
            </span>
        case "link":
            return <>
                <a className={"external-link"} href={token.href}>{token.content}</a>
                <TextNodeRenderer parsedTokens={props.parsedTokens.slice(1)} />
            </>
        case "image":
            return <>
                <a href={token.src} target="_blank">{token.alt || token.src}</a>
                <TextNodeRenderer parsedTokens={props.parsedTokens.slice(1)} />
            </>
        case "text":
            let decorated = <span>{token.text}</span>
            switch (token.decoration) {
                case "bold":
                    decorated = <b>{token.text}</b>
                    break;
                case "italic":
                    decorated = <i>{token.text}</i>
                    break;
                case "underline":
                    decorated = <u>{token.text}</u>
                    break;
                case "strikethrough":
                    decorated = <s>{token.text}</s>
                    break;
                case "code":
                    decorated = <code className="code-block">{token.text}</code>
                    break;
                default:
                    break;
            }
            if ("location" in token) {
                return <>
                    <a href="#" className="cm-underline obsidian-link" onClick={async ev => {
                        await highlightLine(app, token.location)
                        ev.preventDefault()
                    }}> {decorated} </a>
                    <TextNodeRenderer parsedTokens={props.parsedTokens.slice(1)} />
                </>
            }
            return <>
                {decorated}
                <TextNodeRenderer parsedTokens={props.parsedTokens.slice(1)} />
            </>
    }
}

