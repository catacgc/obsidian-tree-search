import {describe, it} from "@jest/globals";
import {fixture, testSearchEquals} from "./fixtures";

describe('archive support', () => {
	it('removes entire file archive', () => {
		const graph = fixture(
	`File1.md,{"tags":["archive"]}
	- [[File2]]
	`,
			`File2.md,{"tags":["document"]}`,
		);

		testSearchEquals(graph, 'file', `
		[[File2]]
		`)
	})

	it('excludes lines', () => {
		const graph = fixture(
			`File.md
	- http://example.com
	- http://example.com #archive
	`
		);

		testSearchEquals(graph, 'file', `
		[[File]]
		 http://example.com
		`)
	})

	it('excludes marked headers / sections', () => {
		const graph = fixture(
			`File.md
	- http://example.com
	### -- Archived --
	- http://example1.com #tag
	- http://example2.com
	`
		);

		testSearchEquals(graph, 'file', `
		[[File]]
		 http://example.com
		`)
	})

});
