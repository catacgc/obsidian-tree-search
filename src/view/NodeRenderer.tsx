import { Token } from "markdown-it";
import { useState } from "react";
import { openFileByName } from "../obsidian-utils";
import { useApp } from "./react-context/AppContext";
import { ParsedNode } from "src/graph";

export const NodeRenderer = (
    props: { tokens: Token[] } | { node: ParsedNode }
) => {
    
    const app = useApp()

    async function openFile(name: string) {
        if (app == undefined) return
        await openFileByName(app, name)
    }
    
    if ("node" in props) {
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
                return <NodeRenderer tokens={props.node.tokens}/>
        }
    }

    const {tokens} = props
    if (tokens.length == 0) return <></>

    const token = tokens[0]

    if (token.type == "inline" && token.children) {
        return <NodeRenderer tokens={token.children}/>
    }
    
    if (token.type == "obsidian_link") {
        const split = token.content.split("|")
        const fileName = split[0].split("#")[0]
        const alias = split[1]

        return <>
            <span className="is-unresolved">
            <a className={"obsidian-link cm-underline"} href="#" onClick={async ev => {
                await openFile(token.content) // TODO: this only opens markdown references
                ev.preventDefault()
            }
            }>{alias || token.content}</a>
            </span>
            <NodeRenderer tokens={tokens.slice(1)}/>
        </>
    }

    if (token.type == "link_open") {
        const href = token.attrs?.[0]?.[1] || "#"
        const content = tokens[1]?.content
        return <>
            <a className={"external-link"} href={href}>{content}</a>
            <NodeRenderer tokens={tokens.slice(2)}/>
        </>
    }

    if (token.type == "link_close") {
        return <NodeRenderer tokens={tokens.slice(1)}/>
    }

    if (token.type == "text") {
        return <>
            <span>{token.content}</span>
            <NodeRenderer tokens={tokens.slice(1)}/>
        </>
    }

    if (token.type == "strong_open") {
        return <b>
            <NodeRenderer tokens={tokens.slice(1)}/>
        </b>
    }

    if (token.type == "strong_close") {
        return <NodeRenderer tokens={tokens.slice(1)}/>
    }

    if (token.type == "em_open") {
        return <em><NodeRenderer tokens={tokens.slice(1)}/></em>
    }

    if (token.type == "softbreak") {
        return <NodeRenderer tokens={tokens.slice(1)}/>
    }

    if (token.type == "s_open") {
        return <s><NodeRenderer tokens={tokens.slice(1)}/></s>
    }

    if (token.type == "image") {
        return <>
            <NodeRendererImage token={token}/>
            <NodeRenderer tokens={tokens.slice(1)}/>
        </>
    }

    if (token.type == "code_inline") {
        return <>
            <code>{token.content}</code>
            <NodeRenderer tokens={tokens.slice(1)}/>
        </>
    }

    if (!token.type.includes("_close")) console.log("tokens not rendered: ", tokens)

    return <NodeRenderer tokens={tokens.slice(1)}/>
}

const NodeRendererImage = (props: { token: Token }) => {
    const [show, setShow] = useState(false)

    return <>
        <span
            onMouseEnter={(ev) => {
                setShow(true);
                ev.preventDefault();
            }}
            onMouseLeave={(ev) => {
                setShow(false);
                ev.preventDefault()
            }}
        >![{props.token.content}]</span>
        {show &&
            <img className={"tree-search-tooltip"} style={{maxWidth: "100px"}} src={props.token.attrs?.[0]?.[1] || ""} alt={props.token.content || ""}/>}
    </>
}
