import {DvPage, EdgeAttributes, GraphAttributes, indexSinglePage, NodeAttributes} from '../src/tree-builder';
import {describe, expect, it, jest} from "@jest/globals";
import {searchIndex} from "../src/search";
import {VAULT_PAGE} from './__mocks__/vaultFixture';
import Graph from "graphology";

// Mock the Obsidian API
jest.mock('obsidian', () => ({
	App: jest.fn(),
	TFile: jest.fn(),
	Vault: jest.fn(),
	Notice: jest.fn(),
}));

jest.mock('obsidian-dataview', () => ({
	getAPI: jest.fn(),
}));

function buildIndex() {
	const graph = new Graph<NodeAttributes, EdgeAttributes, GraphAttributes>()
	indexSinglePage(VAULT_PAGE as unknown as DvPage, graph);
	return graph;
}

describe('indexTree', () => {
	it('should index the sample vault correctly', () => {
		const graph = buildIndex();

		expect(graph.nodes()).toContain('[[importantprojects]]'); //lowercase keys
		expect(graph.nodes()).toContain('[[project1]]');
	});

	it('should search the sample vault correctly', () => {
		const graph = buildIndex();

		const result = searchIndex(graph, 'Important');
		expect(result.length).toBe(1)	// importantprojects
		expect(result[0].children.length).toBe(2) // project1 and project2
	})
});

describe('search operators', () => {
	it("should return a nested search filter", () => {
		const graph = buildIndex();

		const result = searchIndex(graph, 'important > project2');
		expect(result[0].children[0].value).toBe('[[project2]]')
	})

	it("should do an AND when multiple search terms", () => {
		const graph = buildIndex();

		const result = searchIndex(graph, 'task tracker');
		expect(result.length).toBe(1)
	})
})
