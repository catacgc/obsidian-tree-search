import {DvList, DvPage, EdgeAttributes, GraphAttributes, indexSinglePage, NodeAttributes} from "../src/tree-builder";
import Graph from "graphology";
import {ResultNode, searchIndex} from "../src/search";
import {expect} from "@jest/globals";

export function buildIndexFromFixture(page: string, lines: string) {
	const graph = new Graph<NodeAttributes, EdgeAttributes, GraphAttributes>()
	const pageFixture = createFixture(page, lines);
	indexSinglePage(pageFixture, graph);
	return graph;
}

export function renderTextResult(result: ResultNode[]): string {
	return renderResult(result).join("\n")
}

export function renderResult(result: ResultNode[], indent = ""): string[] {
	if (result.length === 0) {
		return []
	}

	return result.flatMap(it => [indent + it.attrs.tokens.map(t => t.content).join(" "),
		...renderResult(it.children, indent + " ")])
}

export function testGraphSearch(graph: Graph<NodeAttributes, EdgeAttributes, GraphAttributes>, qs: string, expected: string) {
	const resultNodes = searchIndex(graph, qs);
	const result = renderTextResult(resultNodes);
	const exp = expected.trim();
	expect(result).toEqual(exp)
}

export function createFixture(name: string, lines: string) {
	return createPageFixture(name, lines.trim().split("\n"))
}

function createPageFixture(path: string, lines: string[]): DvPage {
	const name = path.replace(".md", "");
	const page = {
		"aliases": [],
		"file": {
			"name": name,
			"path": path,
			"lists": {
				"values": lines.map((line, i) => createItemFixture(name, line, i))
			},
			"frontmatter": {},
			"mtime": {
				"ts": 0,
				"c": {
					"year": 0,
					"month": 0,
					"day": 0
				}
			},
		},
		tags: []
	}

	page.file.lists.values = embedChildren(page.file.lists.values)

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

function createItemFixture(file: string, line: string, lineNum: number): DvList {
	return {
		"link": {
			"path": file,
			// "embed": false,
			// "type": "file"
		},
		// "section": {
		// 	"path": file,
		// 	"embed": false,
		// 	"type": "file"
		// },
		"text": line.replace("-", "").trim(),
		"tags": [],
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
