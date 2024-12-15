import {describe, it} from "@jest/globals";
import {expectSearch, fixture, result} from "./fixtures";

describe('frontmatter relations', () => {
	it('parent relations', async () => {
		const graph = await fixture(`
		File.md`, `
		Child.md,{"parent":["[[File]]"]}
		`
		);

		expectSearch(graph, 'file').toEqual(result(`
		[[File]]
		 [[Child]]
		`))
	})

});
