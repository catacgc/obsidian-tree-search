import {describe, it} from "@jest/globals";
import {fixture, testSearchEquals} from "./fixtures";

describe('frontmatter relations', () => {
	it('parent relations', () => {
		const graph = fixture(`
		File.md`, `
		Child.md,{"parent":["[[File]]"]}
		`
		);

		testSearchEquals(graph, 'file', `
		[[File]]
		 [[Child]]
		`)
	})

});
