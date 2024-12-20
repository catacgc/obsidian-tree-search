import {DvList, indexSinglePage} from "../src/tree-builder";
import {ResultNode, searchIndex} from "../src/search";
import {expect} from "@jest/globals";
import {NotesGraph} from "../src/graph";
import { getSettings } from "src/view/react-context/settings";

export function buildIndexFromFixture(page: string, lines: string, aliases: string[] = []) {
	const graph = new NotesGraph()
	const pageFixture = createFixture(page, lines, aliases);
	indexSinglePage(pageFixture, graph, getSettings());
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


export async function testParentOf(graph: NotesGraph, parent: string, child: string) {
	expect(graph.graph.edge(parent.toLowerCase(), child.toLowerCase())).toBeTruthy()
}

export function expectSearch(graph: NotesGraph, qs: string) {
    const resultNodes = searchIndex(graph.graph, qs);
    const result = renderTextResult(resultNodes);
    return expect(result)
}

export function result(expected: string) {
    return trimIndent(expected.split("\n")).join("\n");
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
		await indexSinglePage(pageFixture, graph, getSettings());
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

    const headers = lines.filter(it => it.trim().startsWith("#"))
        .map(((it, line) => {
            return {
                level: 1,
                heading: it.trim().replace("#", "").trim(),
                position: {
                    start: {line:0, col:0, offset:0},
                    end: {line:0, col:0, offset:0}
                }
            }
        }));

	let header = ""
	const items: DvList[] = []
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim().startsWith("#")) {
			header = line;
            continue
		}

		const tagPattern = /#\w+/g;
		const tags = line.match(tagPattern) || [];

		items.push(createItemFixture(name, line, i, header, tags))
	}

	const page = {
        "headers": headers,
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
		if (line.parent !== undefined) {
			lines.find(it => it.line == line.parent)?.children.push(line)
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
		"parent": line.startsWith("-") ? undefined : lineNum - 1,
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
