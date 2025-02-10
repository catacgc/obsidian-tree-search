import {describe, expect, it} from "@jest/globals";
import {matchQuery, parseQuery} from "../src/query";
import {EMPTY_NODE, NodeAttributes} from "../src/graph";

describe('parseSearchQuery', () => {
	it('queries', () => {
		const text = "A B C";

		function matchQueryT(text: string, query: string) {
			const attrs: NodeAttributes = {...EMPTY_NODE, ...{searchKey: text}}
			return matchQuery(attrs, parseQuery(query));
		}
		
		expect(matchQueryT(text, "-A")).toBeFalsy();
		expect(matchQueryT(text, "A")).toBeTruthy();
		expect(matchQueryT(text, "D")).toBeFalsy()
		expect(matchQueryT(text, "-D")).toBeTruthy()
		expect(matchQueryT(text, "A -D")).toBeTruthy();
		expect(matchQueryT(text, "A B")).toBeTruthy();
		expect(matchQueryT(text, "A | D")).toBeTruthy();
		expect(matchQueryT(text, "A -B")).toBeFalsy();
		expect(matchQueryT(text, "-")).toBeFalsy();
		expect(matchQueryT(text, "")).toBeTruthy();
	});
});

describe('Query Parser', () => {
	it('parses simple contains query', () => {
		expect(parseQuery('value')).toEqual({
			type: 'contains',
			value: 'value'
		});
	});

	it('parses exact match query', () => {
		expect(parseQuery('"page"')).toEqual({
			type: 'equals',
			value: 'page'
		});
	});

	it('parses negation', () => {
		expect(parseQuery('-value')).toEqual({
			type: 'not',
			expr: { type: 'contains', value: 'value' }
		});
	});

	it('parses negation with additional terms', () => {
		expect(parseQuery('-value test')).toEqual({
			type: 'and',
			exprs: [
				{ type: 'not', expr: { type: 'contains', value: 'value' } },
				{ type: 'contains', value: 'test' }
			]
		});
	});

	it('parses AND expressions', () => {
		expect(parseQuery('value test')).toEqual({
			type: 'and',
			exprs: [
				{ type: 'contains', value: 'value' },
				{ type: 'contains', value: 'test' }
			]
		});
	});

	it('parses OR expressions', () => {
		expect(parseQuery('value | test')).toEqual({
			type: 'or',
			exprs: [
				{ type: 'contains', value: 'value' },
				{ type: 'contains', value: 'test' }
			]
		});
	});

	it('parses modifiers', () => {
		expect(parseQuery('value :task')).toEqual({
			type: 'and',
			exprs: [
				{ type: 'contains', value: 'value' },
				{ type: 'modifier', value: ':task' }
			]
		});
	});

	it('parses multiple modifiers with OR', () => {
		expect(parseQuery(':header | :page')).toEqual({
			type: 'or',
			exprs: [
				{ type: 'modifier', value: ':header' },
				{ type: 'modifier', value: ':page' }
			]
		});
	});

	it('handles empty queries', () => {
		expect(parseQuery('')).toEqual({type: 'empty'})
	});

	it('handles whitespace', () => {
		expect(parseQuery('  value  test  ')).toEqual({
			type: 'and',
			exprs: [
				{ type: 'contains', value: 'value' },
				{ type: 'contains', value: 'test' }
			]
		});
	});

	it('parses starts with query correctly', () => {
		expect(parseQuery('"project')).toEqual({
			type: 'startsWith',
			value: 'project'
		});
	});

	it('parses exact match correctly', () => {
		expect(parseQuery('"project"')).toEqual({
			type: 'equals',
			value: 'project'
		});
	});

	it('handles multiple modifiers', () => {
		expect(parseQuery('value :task :emoji')).toEqual({
			type: 'and',
			exprs: [
				{ type: 'contains', value: 'value' },
				{ type: 'modifier', value: ':task' },
				{ type: 'modifier', value: ':emoji' }
			]
		});
	});

	it('handles complex combinations', () => {
		console.log(parseQuery('"project -done :task | "meeting" :emoji'))
		expect(parseQuery('"project -done :task | "meeting" :emoji')).toEqual({
			type: 'or',
			exprs: [
				{
					type: 'and',
					exprs: [
						{ type: 'startsWith', value: 'project' },
						{ type: 'not', expr: { type: 'contains', value: 'done' } },
						{ type: 'modifier', value: ':task' }
					]
				},
				{
					type: 'and',
					exprs: [
						{ type: 'equals', value: 'meeting' },
						{ type: 'modifier', value: ':emoji' }
					]
				}
			]
		});
	});

	it('handles complex grouped expressions', () => {
		expect(parseQuery('project task | meeting :emoji | "exact" test')).toEqual({
			type: 'or',
			exprs: [
				{
					type: 'and',
					exprs: [
						{ type: 'contains', value: 'project' },
						{ type: 'contains', value: 'task' }
					]
				},
				{
					type: 'and',
					exprs: [
						{ type: 'contains', value: 'meeting' },
						{ type: 'modifier', value: ':emoji' }
					]
				},
				{
					type: 'and',
					exprs: [
						{ type: 'equals', value: 'exact' },
						{ type: 'contains', value: 'test' }
					]
				}
			]
		});
	});
});
