import {describe, expect, it} from "@jest/globals";
import {fixture} from "./fixtures";
import {NotesGraph} from "../src/graph";
import { searchIndex } from "../src/search";
import { reverseMarkdownParsing } from "../src/copy";


describe('copy operation for search results', () => {
	
	it('copy a node line', async () => {
		const nestedGraph = await fixture(`
		File.md
		- [[Project]] http://ImportantLink.com #tag \`snippet\` [Test](http://test)
		`);

		const qs = "Important";
		const resultNodes = searchIndex(nestedGraph.graph, qs);
        const line = reverseMarkdownParsing(resultNodes[0].attrs.tokens)
        expect(line).toEqual("[[Project]] http://ImportantLink.com #tag `snippet` [Test](http://test)")
	});

    it('copy a node header', async () => {
		const nestedGraph = await fixture(`
		File.md
		- [[Project#Header]]
		`);

		const resultNodes = searchIndex(nestedGraph.graph, "header");
        const line = reverseMarkdownParsing(resultNodes[0].attrs.tokens)
        expect(line).toEqual("[[Project#Header]]")
	});
});
