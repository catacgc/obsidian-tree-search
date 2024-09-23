import {Token} from "markdown-it";
import {useApp} from "./hooks";
import {ResultNode} from "../search";
import {NodeAttributes} from "../graph";
import {openFileAndHighlightLine, openFileByName} from "../obsidian-utils";

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

export const NodeView = (props: { node: ResultNode, index: number }) => {
	const app = useApp()

	async function openFile(attrs: NodeAttributes) {
		if (app == undefined) return
		await openFileAndHighlightLine(app, attrs.location.path, attrs.location.position.start, attrs.location.position.end)
	}

	const attrs = props.node.attrs

	return <div
		className="search-tree-node"
		onClick={async (ev) => {
			if (ev.isDefaultPrevented()) {
				return
			}
			await openFile(attrs)
		}}
	>
		{props.node.attrs.nodeType == "task" ? <input type={"checkbox"} disabled={true}/> :
			(props.node.attrs.nodeType == "completed-task" ?
				<input type={"checkbox"} checked={true} disabled={true}/> : "↳")
		}
		<NodeRenderer
			tokens={props.node.attrs.tokens}/> {props.node.attrs.aliases.length > 0 && `(${props.node.attrs.aliases.join(", ")})`}
	</div>
}
