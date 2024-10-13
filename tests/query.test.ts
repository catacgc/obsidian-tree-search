import {describe, expect, it} from "@jest/globals";
import {matchQuery, parseQuery} from "../src/query";
import { EMPTY_NODE, NodeAttributes } from "../src/graph";

describe('parseSearchQuery', () => {
	it('queries', () => {
		const text = "This is a sample text for testing";

		function matchQueryT(text: string, query: string) {
			const attrs: NodeAttributes = {...EMPTY_NODE, ...{searchKey: text}}
			return matchQuery(attrs, parseQuery(query));
		}

		expect(matchQueryT(text, "-for")).toBeFalsy();
		expect(matchQueryT(text, "example")).toBeFalsy();
		expect(matchQueryT(text, "for")).toBeTruthy();
		expect(matchQueryT(text, "-example")).toBeTruthy();
		expect(matchQueryT(text, "sample AND -example")).toBeTruthy();
		expect(matchQueryT(text, "sample text OR testing -example")).toBeTruthy();
		expect(matchQueryT(text, "sample -text OR testing -for")).toBeFalsy();
		expect(matchQueryT(text, "-")).toBeFalsy();
	});
});
