import {describe, it} from "@jest/globals";
import {expectSearch, fixture, result} from "./fixtures";

describe('archive support', () => {
	it('removes entire file archive', async () => {
		const graph = await fixture(
	`File1.md,{"tags":["archive"]}
	- [[File2]]
	`,
			`File2.md,{"tags":["document"]}`,
		);

		expectSearch(graph, 'file').toEqual(result(`
		[[File2]]
		`))
	})

	it('excludes lines', async () => {
		const graph = await fixture(
			`File.md
	- http://example.com
	- http://example.com #archive
	`
		);

		expectSearch(graph, 'file').toEqual(result(`
		[[File]]
		 http://example.com
		`))
	})

	it('excludes marked headers / sections', async () => {
		const graph = await fixture(
			`File.md
	- http://example.com
	# -- Archived --
	- http://example1.com #tag
	- http://example2.com
	# Not Archived
	- http://example4.com
	`
		);

		expectSearch(graph, 'file').toEqual(result(`
		[[File]]
		 File > -- Archived --
		 File > Not Archived
		  http://example4.com
		 http://example.com
		`))
	})

});
