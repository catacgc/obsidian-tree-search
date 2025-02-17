import { openFileByName } from "../obsidian-utils";
import { useApp } from "./react-context/AppContext";
import { ParsedNode, ParsedTextToken } from "src/graph";

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
                <img className={"tree-search-tooltip"} style={{maxWidth: "100px"}} src={token.src} alt={token.alt || ""}/>
                <TextNodeRenderer parsedTokens={props.parsedTokens.slice(1)}/>
            </>
        case "text":
            return <>
                <span>{token.text}</span>
                <TextNodeRenderer parsedTokens={props.parsedTokens.slice(1)}/>
            </>
    }
}
