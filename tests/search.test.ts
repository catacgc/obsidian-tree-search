import {EdgeAttributes, GraphAttributes, indexSinglePage, NodeAttributes} from '../src/tree-builder';
import {describe, expect, it} from "@jest/globals";
import Graph from "graphology";
import {buildIndexFromFixture, createFixture, testGraphSearch} from "./fixtures";



describe('index and search operators', () => {
	const graph1 = buildIndexFromFixture('ImportantProjects.md', `
- [[Project1]]
- [[Project2]]
		`);

	const nestedGraph = buildIndexFromFixture('ImportantProjects.md', `
- [[Project1]]
	- [[Task1]]
- [[Project2]]
	- [[Task2]]
		`);


	it('should index the sample vault correctly', () => {
		expect(graph1.nodes()).toContain('[[importantprojects]]'); //lowercase keys
		expect(graph1.nodes()).toContain('[[project1]]');
		expect(graph1.nodes()).toContain('[[project2]]');
	});

	it('should search filenames', () => {
		testGraphSearch(nestedGraph, 'Important', `
[[ImportantProjects]]
 [[Project1]]
  [[Task1]]
 [[Project2]]
  [[Task2]]
`);
	});

	it('should search nested', () => {

		testGraphSearch(nestedGraph, 'Important > Project2', `
[[ImportantProjects]]
 [[Project2]]
  [[Task2]]
`);
	});

// 	it('should exclude nested', () => {
// 		testGraphSearch(nestedGraph, 'Important > -Project1', `
// [[ImportantProjects]]
//  [[Project2]]
//   [[Task2]]
// `);
// 	})




	it('inline mentions', () => {
		const inlineMentions = buildIndexFromFixture('ImportantProjects.md', `
- [[Project1]]
- [[Project1]] with an inline mention
	- Task1 related to [[Topic1]]
- [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
`);

		testGraphSearch(inlineMentions, 'Project1', `
[[Project1]]
 [[Project1]] with an inline mention
 [[Topic1]]
  Task1 related to [[Topic1]]
  [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
[[Project1]] with an inline mention
`);
	})

	it('reference embedding', () => {
		const inlineMentions = buildIndexFromFixture('ImportantProjects.md', `
- [[Project1]]
- [[Project1]] with an inline mention
	- Task1 related to [[Topic1]]
- [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
`);

		testGraphSearch(inlineMentions, 'important', `
[[ImportantProjects]]
 [[Project1]]
  [[Project1]] with an inline mention
  [[Topic1]]
   Task1 related to [[Topic1]]
   [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
 [[Project2]]
`);
	})

	it('find nested references', () => {
		const graph = buildIndexFromFixture('ImportantProjects.md', `
- [[Project1]]
- [[Project1]] with an inline mention
	- Task1 related to [[Topic1]]
- [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
`);

		testGraphSearch(graph, 'topic1', `
[[Topic1]]
 [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
Task1 related to [[Topic1]]
[[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]	
`);
		testGraphSearch(graph, 'topic2', `
[[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
[[Topic2]]
`);
	})

	it('check for circular references', () => {
		const graph = new Graph<NodeAttributes, EdgeAttributes, GraphAttributes>()
		const page1 = createFixture("Project1.md", `
- [[Task1]]
	- [[Note1]]
`);
		const page2 = createFixture("Task1.md", `
- [[Note2]]
	- [[Project1]]
`);
		indexSinglePage(page1, graph);
		indexSinglePage(page2, graph);

		testGraphSearch(graph, 'project1', `
[[Project1]]
 [[Task1]]
  [[Note1]]
  [[Note2]]
`);
	})
});
