import { NotesGraph, PageNode } from "src/graph";
import {createFixture, edit, fixture, search} from "./fixtures";
import {describe, expect, test} from "@jest/globals";

async function printGraph(graph: NotesGraph) {
	const data = graph.graph.export();
	console.log(JSON.stringify(data, null, 1));
}
describe('createFixture', () => {
	test("sample graph", async () => {
		const graph = await fixture(`
ImportantProjects.md,{"aliases":["alias"]}
- [[Project1]]
 	- [[Project2]]
 	 	- [[Project3]]
`)
		expect(graph.graph.nodes()).toContain("[[importantprojects]]")
		expect(graph.graph.nodes()).toContain("[[project1]]")
		expect(graph.graph.nodes()).toContain("[[project2]]")
		expect(graph.graph.nodes()).toContain("[[project3]]")
		expect(graph.graph.getNodeAttributes('[[importantprojects]]').searchKey).toEqual("importantprojects|alias")
		expect(graph.graph.getNodeAttributes('[[project1]]').searchKey).toEqual("project1")
		expect(graph.graph.hasDirectedEdge("[[project1]]", "[[project2]]")).toBeTruthy()
		expect(graph.graph.hasDirectedEdge("[[project2]]", "[[project3]]")).toBeTruthy()
	})

	test("createFixture", () => {
		const fixture = createFixture("test", `
- [[Test]]
	- [[TestChild]]
		- [[TestGrandChild]]
		`)

		expect(fixture.file.lists.values.length).toBe(3)
		expect(fixture.file.lists.values[0].children.length).toBe(1)
		expect(fixture.file.lists.values[0].children[0].children.length).toBe(1)
	})

	test("headers support", async () => {
		const graph = await fixture(`
		File.md
		# TopLevelHeader
		- [[TopLevelRef]]
		## Header
		- [[Note]]
			- [[Note2]]
		- [[Note3#Header]]
			- [[Note4#Header]]
		`)

		expect(graph.graph.getNodeAttributes('file#toplevelheader').nodeType).toBe('header')
		expect(graph.graph.getNodeAttributes('file#header').nodeType).toBe('header')
		expect(graph.graph.hasEdge('file#toplevelheader', 'file#header')).toBeTruthy()
		expect(graph.graph.hasEdge('file#header', '[[note]]')).toBeTruthy()
		expect(graph.graph.hasEdge('[[note]]', '[[note2]]')).toBeTruthy()
		// expect(graph.graph.hasEdge('[[file]]', '[[note2]]')).toBeFalsy()
		expect(graph.graph.hasEdge('file#header', 'note3#header')).toBeTruthy()
		// printGraph(graph)

		expect(graph.graph.hasEdge('[[note3]]', 'note3#header')).toBeTruthy()
		expect(graph.graph.hasEdge('note3#header', 'note4#header')).toBeTruthy()
	
	})

	test("page and virtual-page support", async () => {
		const graph = await fixture(`
		File.md
		-    [[Note]]
		  -  [[Note2]]
		`,`
		Note2.md
		- [[Note3]]
		`)

		expect(graph.graph.hasEdge('[[file]]', '[[note]]')).toBeTruthy()
		expect(graph.graph.hasEdge('[[note]]', '[[note2]]')).toBeTruthy()
		expect(graph.graph.hasEdge('[[note2]]', '[[note3]]')).toBeTruthy()
		expect(graph.graph.getNodeAttributes('[[file]]').nodeType).toBe('page')

		const attrs = graph.graph.getNodeAttributes('[[note]]')
		expect(attrs.nodeType).toBe('page')
		if (attrs.nodeType == 'page') {
			expect(attrs.isReference).toBeTruthy()
		}

		expect(graph.graph.getNodeAttributes('[[note2]]').nodeType).toBe('page')
	})

	test("aliases support", async () => {
		const graph = await fixture(`
		File.md
		- [[Note|A]]
			- [[Note1|B]]
		`)

		expect(graph.graph.hasEdge('[[file]]', '[[note]]')).toBeTruthy()
		expect(graph.graph.hasEdge('[[note]]', '[[note1]]')).toBeTruthy()

		const attrs = graph.graph.getNodeAttributes('[[note]]') as PageNode
		expect(attrs.aliases).toEqual(['A'])

		const attrs2 = graph.graph.getNodeAttributes('[[note1]]') as PageNode
		expect(attrs2.aliases).toEqual(['B'])
	})

	test("list items support", async () => {
		const graph = await fixture(`
		File.md
		- reference [[Note|A]] [[Note1#B|C]]
		- [[Note1#B|D]]
		`)

		expect(graph.graph.hasEdge('[[file]]', 'reference [[note|a]] [[note1#b|c]]')).toBeTruthy()
		expect(graph.graph.hasEdge('[[note]]', 'reference [[note|a]] [[note1#b|c]]')).toBeTruthy()
		expect(graph.graph.hasEdge('note1#b', 'reference [[note|a]] [[note1#b|c]]')).toBeTruthy()
		
		const attrs = graph.graph.getNodeAttributes('[[note1]]') as PageNode
		expect(attrs.aliases).toContain('C')
		expect(attrs.aliases).toContain('D')
	})

	test("tags support", async () => {
		const graph = await fixture(`
		File.md
		- reference #tag
		`)

		expect(graph.graph.hasEdge('[[file]]', 'reference #tag')).toBeTruthy()
	})

	test("parent with header support", async () => {
		const graph = await fixture(`
		File.md,{"parent":["[[some#parent]]"]}
		`)

		expect(graph.graph.hasEdge('[[some]]', 'some#parent')).toBeTruthy()
		expect(graph.graph.hasEdge('some#parent', '[[file]]')).toBeTruthy()
	})

    test("nested children", async () => {
        const graph = await fixture(`
		File.md
		- [[Parent]]
		    - [[Child]]
				- [[GrandChild]]
		`)

        expect(graph.graph.hasEdge('[[file]]', '[[parent]]')).toBeTruthy()
        expect(graph.graph.hasEdge('[[file]]', '[[child]]')).toBeFalsy()
        expect(graph.graph.hasEdge('[[parent]]', '[[child]]')).toBeTruthy()
		expect(graph.graph.hasEdge('[[child]]', '[[grandchild]]')).toBeTruthy()
    })

    test("create headers as children even if no line exists", async () => {
        const graph = await fixture(`
		File.md
		# Child1
		# Child2
		`)

        expect(graph.graph.hasEdge('[[file]]', 'file#child1')).toBeTruthy()
        expect(graph.graph.hasEdge('[[file]]', 'file#child2')).toBeTruthy()
    })

});
