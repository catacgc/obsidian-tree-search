import {describe, it} from "@jest/globals";
import {expectSearch, fixture, result} from "./fixtures";

describe('edit capabilities, graph updates', () => {
	it('should delete an edge and a node from page', async () => {
		const graph = await fixture(`
		File.md
		- [[Node]]
			- [[ChildNode]]`,`
		File.md
		- [[Node1]]
		`
	);

		expectSearch(graph, 'node').toEqual(result(`
		[[Node1]]
		`))
	})

	it('should keep the node if it is present in another page', async () => {
		const graph = await fixture(`
		File.md
		- [[Node]]
			- [[ChildNode]]`,`
		File-another.md
		- [[Node]]`,`
		File.md
		- [[Node1]]
		`
		);

		expectSearch(graph, 'node').toEqual(result(`
		[[Node1]]
		[[Node]]
		`))
	})

	it('should not delete nodes from parent', async () => {
		const graph = await fixture(`
		File.md
		- [[Node]]`,`
		Child.md,{"parent": ["[[File]]"]}
		- [[Node2]]`,`
		Child.md,{"parent": ["[[File]]"]}
		- [[Node3]]`
		);

		expectSearch(graph, 'File').toEqual(result(`
		[[File]]
		 [[Node]]
		 [[Child]]
		  [[Node3]]
		`))
	})
});
