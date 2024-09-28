import {describe, it} from "@jest/globals";
import {fixture, testSearchEquals} from "./fixtures";

describe('edit capabilities, graph updates', () => {
	it('should delete an edge and a node from page', () => {
		const graph = fixture(`
		File.md
		- [[Node]]
			- [[ChildNode]]`,`
		File.md
		- [[Node1]]
		`
	);

		testSearchEquals(graph, 'node', `
		[[Node1]]
		`)
	})

	it('should keep the node if it is present in another page', () => {
		const graph = fixture(`
		File.md
		- [[Node]]
			- [[ChildNode]]`,`
		File-another.md
		- [[Node]]`,`
		File.md
		- [[Node1]]
		`
		);

		testSearchEquals(graph, 'node', `
		[[Node]]
		[[Node1]]
		`)
	})

	it('should not delete nodes from parent', () => {
		const graph = fixture(`
		File.md
		- [[Node]]`,`
		Child.md,{"parent": ["[[File]]"]}
		- [[Node2]]`,`
		Child.md,{"parent": ["[[File]]"]}
		- [[Node3]]`
		);

		testSearchEquals(graph, 'File', `
		[[File]]
		 [[Node]]
		 [[Child]]
		  [[Node3]]
		`)
	})

});
