import MarkdownIt, { Token } from 'markdown-it';
import { ParsedTextToken } from './graph';

function obsidianLinkPlugin(md: MarkdownIt) {
	// Define a rule to match the pattern [[text]] and not ![[text]]
	md.inline.ruler.before('link', 'obsidian-link', (state, silent) => {
		const max = state.posMax;
		const start = state.pos;

		if (start + 4 > max) return false;
		if (state.src.charAt(start-1) == '!' || state.src.charAt(start) !== '[' || state.src.charAt(start + 1) !== '[' /* [ */) {
			return false;
		}

		let end = start + 2;
		while (end < max) {
			if (state.src.charAt(end) === ']' && state.src.charAt(end + 1) === ']') {
				break;
			}
			end++;
		}

		if (end >= max) return false;

		if (!silent) {
			const content = state.src.slice(start + 2, end);
			const token = state.push('obsidian_link', 'a', 0);
			token.content = content;
		}

		state.pos = end + 2;
		return true;
	});

	// Define a renderer to render the matched text as plain text
	md.renderer.rules.obsidian_link = (tokens, idx) => {
		return tokens[idx].content;
	};
}

export function parseTokens(markdownString: string): ParsedTextToken[] {
	return _parseTokens(_parseMarkdown(markdownString, {}))
}

function _parseMarkdown(markdownText: string, env: any) {
	// Initialize markdown-it with the custom plugin
	const md = new MarkdownIt().use(obsidianLinkPlugin);

	// Parse the markdown text
	const result = md.parseInline(markdownText, env);

	return result;
}


function _parseTokens(tokens: Token[]): ParsedTextToken[] {
    if (tokens.length == 0) return []
    const token = tokens[0]

    if (token.type == "inline" && token.children) {
        return _parseTokens(token.children)
    }

    if (token.type == "obsidian_link") {
        const link = token.content

        const actualRef = `[[${link}]]`
        const split = link.split("|")
        const alias = split[1]
        const withHeader = split[0]
        const headerSplit = withHeader.split("#")
        const fileName = resolveReference(headerSplit[0])
        const header = headerSplit[1]
        
        return [
            {tokenType: "obsidian_link", source: actualRef, pageTarget: fileName, headerName: header, alias: alias},
            ..._parseTokens(tokens.slice(1))
        ]
    }

    if (token.type == "link_open") {
        const href = token.attrs?.[0]?.[1] || "#"
        const content = tokens[1]?.content
        return [
            {tokenType: "link", href: href, content: content},
            ..._parseTokens(tokens.slice(2))
        ]
    }
    
    const decorationMap: Record<string, string> = {
        "text": "none",
        "strong_open": "bold",
        "em_open": "italic",
        "s_open": "strikethrough",
        "code_inline": "code"
    };

    if (token.type in decorationMap) {
        return [
            {tokenType: "text", text: token.content, decoration: decorationMap[token.type] as "italic" | "bold" | "underline" | "strikethrough" | "code" | "none"},
            ..._parseTokens(tokens.slice(1))
        ]
    }

    if (token.type == "image") {
        return [
            {tokenType: "image", src: token.attrs?.[0]?.[1] || "", alt: token.content},
            ..._parseTokens(tokens.slice(1))
        ]
    }

    if (!token.type.includes("_close")) console.log("tokens not rendered: ", tokens)

    return _parseTokens(tokens.slice(1))
}


/** This is very dump and probably needs the app context to get the actual reference */
function resolveReference(ref: string): string {
	if (ref.includes("/")) {
		return ref.split("/")[1]
	}

	return ref
}