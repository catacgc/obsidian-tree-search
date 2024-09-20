import MarkdownIt from 'markdown-it';

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

export function parseMarkdown(markdownText: string, env: any) {
	// Initialize markdown-it with the custom plugin
	const md = new MarkdownIt().use(obsidianLinkPlugin);

	// Parse the markdown text
	const result = md.parseInline(markdownText, env);

	return result;
}
