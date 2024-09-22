import {createFixture, fixture} from "./fixtures";
import {describe, expect, test} from "@jest/globals";

describe('createFixture', () => {
	test("sample graph", async () => {
		const graph = await fixture(`
ImportantProjects.md,alias
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
		#Header
		- [[Note]]
			- [[Note2]]
		`)

		expect(graph.graph.getNodeAttributes('#header').nodeType).toBe('header')
		expect(graph.graph.hasEdge('#header', '[[note]]')).toBeTruthy()
		expect(graph.graph.hasEdge('[[note]]', '[[note2]]')).toBeTruthy()

	})
});
