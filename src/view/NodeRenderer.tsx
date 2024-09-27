import {Token} from "markdown-it";
import {useApp} from "./AppContext";
import {openFileByName} from "../obsidian-utils";

export const NodeRenderer = (props: { tokens: Token[] }) => {
	const { tokens } = props
	const app = useApp()

	if (tokens.length == 0) return <></>

	const token = tokens[0]

	async function openFile(name: string) {
		if (app == undefined) return
		await openFileByName(app, name)
	}

	if (token.type == "inline" && token.children) {
		return <NodeRenderer tokens={token.children}/>
	}
	if (token.type == "obsidian_link") {
		return <>
			<a className={"obsidian-link"} href="#" onClick={async ev => {
					await openFile(token.content + ".md") // TODO: this only opens markdown references
					ev.preventDefault()
			}
			}>{token.content}</a>
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

	// if (!token.type.includes("_close")) console.log("tokens not rendered: ", tokens)

	return <NodeRenderer tokens={tokens.slice(1)}/>
}

