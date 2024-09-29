import {DvList, indexSinglePage} from "../src/tree-builder";
import {ResultNode, searchIndex} from "../src/search";
import {expect} from "@jest/globals";
import {NotesGraph} from "../src/graph";
import {REACT_PLUGIN_CONTEXT} from "../src/view/PluginContext";

export function buildIndexFromFixture(page: string, lines: string, aliases: string[] = []) {
	const graph = new NotesGraph()
	const pageFixture = createFixture(page, lines, aliases);
	indexSinglePage(pageFixture, graph, REACT_PLUGIN_CONTEXT.settings);
	return graph;
}

export function renderTextResult(result: ResultNode[]): string {
	return renderResult(result).join("\n")
}

export function renderResult(result: ResultNode[], indent = ""): string[] {
	if (result.length === 0) {
		return []
	}

	return result.flatMap(it => [
		indent + it.attrs.tokens.map(t => t.content) + (it.attrs.aliases.length > 0 ? " " + it.attrs.aliases : ""),
		...renderResult(it.children, indent + " ")
	])
}

export async function testSearchContains(promiseGraph: Promise<NotesGraph>, qs: string, expected: string) {
	const graph = await promiseGraph;
	const resultNodes = searchIndex(graph.graph, qs);
	const result = renderTextResult(resultNodes);
	const exp = trimIndent(expected.split("\n")).join("\n");
	expect(result).toContain(exp)
}

export async function testSearchEquals(promiseGraph: Promise<NotesGraph>, qs: string, expected: string) {
	const graph = await promiseGraph;
	const resultNodes = searchIndex(graph.graph, qs);
	const result = renderTextResult(resultNodes);
	const exp = trimIndent(expected.split("\n")).join("\n");
	expect(result).toEqual(exp)
}

/**
 * Bt convention the first line is the page name followed by an optional list of aliases.
 * All comma separated.
 *
 * Following lines will trimIndent to the minimal indent
 */
export async function fixture(...fixtures: string[]): Promise<NotesGraph> {
	const graph = new NotesGraph()
	for (const fixture of fixtures) {
		const lines = fixture.trim().split("\n");
		const pageAliasAndFrontmatter = lines[0].split(",");
		const pagename = pageAliasAndFrontmatter[0] || "";
		const frontMatter = JSON.parse(pageAliasAndFrontmatter[1] || "{}")
		const trimmed = trimIndent(lines.slice(1));

		const pageFixture = createFixture(pagename, trimmed.join("\n"), frontMatter);
		await indexSinglePage(pageFixture, graph, REACT_PLUGIN_CONTEXT.settings);
	}

	return graph
}

/**
 * typescript trimIndent function similar to Kotlin trimIndent.
 * Detects a common minimal indent of all the input lines, removes it from every line and
 * also removes the first and the last lines if they are blank (notice difference blank vs empty).
 */
function trimIndent(lines: string[]): string[] {

	// Remove the first and last lines if they are blank
	if (lines.length > 0 && lines[0].trim() === '') {
		lines.shift();
	}
	if (lines.length > 0 && lines[lines.length - 1].trim() === '') {
		lines.pop();
	}

	// Detect the common minimal indent
	const indentLengths = lines
		.map(line => line.replace(/\t/g, ' '))
		.filter(line => line.trim().length > 0) // Ignore empty lines
		.map(line => line.match(/^\s*/)?.[0].length || 0);
	const minIndent = Math.min(...indentLengths);

	// Remove the detected indent from each line
	const trimmedLines = lines.map(line => line.slice(minIndent));

	// Join the lines back into a single string
	return trimmedLines;
}

export function createFixture(path: string, linesStr: string, frontMatter: any = {}) {
	const lines = linesStr.trim().split("\n")
	const name = path.replace(".md", "");
	let header = ""
	const items: DvList[] = []
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim().startsWith("#")) {
			header = line;
		}

		const tags = line.includes("#archive") ? ["#archive"] : []

		items.push(createItemFixture(name, line, i, header, tags))
	}

	const page = {
		"file": {
			"aliases": {values: frontMatter.aliases || []},
			"name": name,
			"path": path,
			"lists": {
				"values": items
			},
			"frontmatter": frontMatter,
			"mtime": {
				"ts": 0,
				"c": {
					"year": 0,
					"month": 0,
					"day": 0
				}
			}
			,
			tags: []
		},
	}

	page.file.lists.values = embedChildren(page.file.lists.values).filter(it => !it.text.startsWith("#"))

	return page
}

// do what dataview does: all elements that point to a parent line should be children of that line
export function embedChildren(lines: DvList[]): DvList[] {
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (line.parent !== 0) {
			lines[line.parent - 1].children.push(line)
		}
	}
	return lines
}

function createItemFixture(file: string, line: string, lineNum: number, header: string, tags: string[]): DvList {
	return {
		task: line.includes("- [ ]") || line.includes("- [x]"),
		completed: false,
		"link": {
			"path": file,
			// "embed": false,
			// "type": "file"
		},
		"section": {
			"subpath": header
		},
		"text": line.replace("-", "").trim(),
		"tags": tags,
		"line": lineNum,
		// "lineCount": 1,
		// "list": 4,
		// "path": file,
		"children": [],
		// "task": false,
		// "annotated": false,
		"parent": line.startsWith("-") ? 0 : lineNum,
		"position": {
			"start": {
				"line": lineNum,
				"col": 0,
				// "offset": 45
			},
			"end": {
				"line": lineNum,
				"col": 25,
				// "offset": 70
			}
		},
		// "real": false,
		// "header": {
		// 	"path": lineNum,
		// 	"embed": false,
		// 	"type": "file"
		// }
	}
}