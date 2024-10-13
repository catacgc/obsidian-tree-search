import {createFixture, fixture} from "./fixtures";
import {describe, expect, test} from "@jest/globals";

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
		expect(graph.graph.getNodeAttributes('[[importantprojects]]').searchKey).toEqual("importantprojects alias")
		expect(graph.graph.getNodeAttributes('[[project1]]').searchKey).toEqual("[[project1]]")
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
		# Header
		- [[Note]]
			- [[Note2]]
		- [[Note3#Header]]
			- [[Note4#Header]]
		`)

		expect(graph.graph.getNodeAttributes('file#header').nodeType).toBe('header')
		expect(graph.graph.hasEdge('file#header', '[[note]]')).toBeTruthy()
		expect(graph.graph.hasEdge('[[note]]', '[[note2]]')).toBeTruthy()
		expect(graph.graph.hasEdge('file#header', '[[note3]]')).toBeTruthy()
		expect(graph.graph.hasEdge('[[note3]]', 'note3#header')).toBeTruthy()
		expect(graph.graph.hasEdge('note3#header', '[[note4]]')).toBeTruthy()
	})

	test("aliases support", async () => {
		const graph = await fixture(`
		File.md
		- [[Note|A]]
			- [[Note1|B]]
		`)

		expect(graph.graph.hasEdge('[[file]]', '[[note]]')).toBeTruthy()
		expect(graph.graph.hasEdge('[[note]]', '[[note1]]')).toBeTruthy()
	})

	test("list items support", async () => {
		const graph = await fixture(`
		File.md
		- reference [[Note|A]] [[Note1#B]]
		`)

		expect(graph.graph.hasEdge('[[file]]', 'reference [[note|a]] [[note1#b]]')).toBeTruthy()
		expect(graph.graph.hasEdge('[[note]]', 'reference [[note|a]] [[note1#b]]')).toBeTruthy()
		expect(graph.graph.hasEdge('note1#b', 'reference [[note|a]] [[note1#b]]')).toBeTruthy()
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
		`)

        expect(graph.graph.hasEdge('[[file]]', '[[parent]]')).toBeTruthy()
        expect(graph.graph.hasEdge('[[file]]', '[[child]]')).toBeFalsy()
        expect(graph.graph.hasEdge('[[parent]]', '[[child]]')).toBeTruthy()
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
