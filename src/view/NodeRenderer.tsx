import { text } from "stream/consumers";
import { highlightLine, openFileByName } from "../obsidian-utils";
import { useApp } from "./react-context/AppContext";
import { ParsedNode, ParsedTextToken, TextTokenWithLocationLink } from "src/graph";

export const NodeRenderer = (
    props: { node: ParsedNode }
) => {
    
    const app = useApp()

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
            return <TextNodeRenderer parsedTokens={props.node.parsedTokens}/>
        case "month":
            return <span>{props.node.monthLiteral} {props.node.year}</span>
        case "folder":
            return <span>{props.node.path} 📂</span>
    }
}

export const TextNodeRenderer = (props: { parsedTokens: ParsedTextToken[] }) => {
    const app = useApp()

    async function openFile(name: string) {
        if (app == undefined) return
        await openFileByName(app, name)
    }

    if (props.parsedTokens.length == 0) return <></>
    const token = props.parsedTokens[0]

    switch (token.tokenType) {
        case "obsidian_link":
            return <>
            <a className={"obsidian-link " + (false ? "cm-underline" : "")} href="#" onClick={async ev => {
                await openFile(token.pageTarget)
                ev.preventDefault()
            }}>
                {token.alias || token.pageTarget}
                {token.headerName ? ` > ${token.headerName.trim()}` : ""}
            </a>
            <TextNodeRenderer parsedTokens={props.parsedTokens.slice(1)}/>
            </>
        case "link":
            return <>
                <a className={"external-link"} href={token.href}>{token.content}</a>
                <TextNodeRenderer parsedTokens={props.parsedTokens.slice(1)}/>
            </>
        case "image":
            return <>
                <a href={token.src} target="_blank">{token.alt || token.src}</a>
                <TextNodeRenderer parsedTokens={props.parsedTokens.slice(1)}/>
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
                    <TextNodeRenderer parsedTokens={props.parsedTokens.slice(1)}/>
                </>
            }
            return <>
                {decorated}
                <TextNodeRenderer parsedTokens={props.parsedTokens.slice(1)}/>
            </>
    }
}

