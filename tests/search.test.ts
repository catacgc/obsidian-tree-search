import {describe, expect, it} from "@jest/globals";
import {buildIndexFromFixture, fixture, testSearchContains, testSearchEquals} from "./fixtures";
import {NotesGraph} from "../src/graph";


async function printGraph(graph: Promise<NotesGraph>) {
	const data = (await graph).graph.export();
	console.log(data)
}

describe('index and search operators', () => {
	it('should index the sample vault correctly', () => {
		const graph1 = buildIndexFromFixture('ImportantProjects.md', `
		- [[Project1]]
		- [[Project2]]
				`);
		expect(graph1.graph.nodes()).toContain('[[importantprojects]]'); //lowercase keys
		expect(graph1.graph.nodes()).toContain('[[project1]]');
		expect(graph1.graph.nodes()).toContain('[[project2]]');
	});

	it('should search filenames', () => {
		const nestedGraph = fixture(`
		ImportantProjects.md
		- [[Project1]]
			- [[Task1]]
		- [[Project2]]
			- [[Task2]]
		`);

		testSearchEquals(nestedGraph, 'Important', `
		[[ImportantProjects]]
		 [[Project1]]
		  [[Task1]]
		 [[Project2]]
		  [[Task2]]
		`);
	});

	it('should search nested', () => {
		const nestedGraph = fixture(`
		ImportantProjects.md
		- [[Project1]]
			- [[Task1]]
		- [[Project2]]
			- [[Task2]]
		`);
		testSearchEquals(nestedGraph, 'Important > Project2', `
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
		const inlineMentions = fixture(`Topic1.md`, `
			ImportantProjects.md
			- [[Project1]]
			- [[Project1]] with an inline mention
				- Task1 related to [[Topic1]]
			- [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
			`);

		testSearchEquals(inlineMentions, 'Topic1 -topic2', `
			[[Topic1]]
			 Task1 related to [[Topic1]]
			 [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
			Task1 related to [[Topic1]]
			`);

		testSearchEquals(inlineMentions, 'Project1', `
			[[Project1]]
			 [[Project1]] with an inline mention
			  Task1 related to [[Topic1]]
			[[Project1]] with an inline mention
			`);
	})

	it('references', () => {
		const inlineMentions = fixture(`
		ImportantProjects.md
		- [[Project1]]
		- [[Project1]] with an inline mention
			- Task1 related to [[Topic1]]
		- [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
		`);

		testSearchEquals(inlineMentions, 'important', `
		[[ImportantProjects]]
		 [[Project1]]
		  [[Project1]] with an inline mention
		   Task1 related to [[Topic1]]
		 [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
		`);
	})

	it('find nested references', () => {
		const graph = fixture(`
		DailyNote.md
		- [[Project1]]
		- [[Project1]] with an inline mention
			- Task1 related to [[Topic1]]
		- [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
`);

		testSearchEquals(graph, 'topic1', `
		[[Topic1]]
		 Task1 related to [[Topic1]]
		 [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
		Task1 related to [[Topic1]]
		[[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
		`);

		testSearchEquals(graph, 'topic2', `
		[[Topic2]]
		 [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
		[[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
		`);
	})

	it('index books reference as its own tree ', () => {
		const graph = fixture(`
		Random.md
		- Getting things done [[Books]]
		`)

		testSearchEquals(graph, 'Books', `
		[[Books]]
		 Getting things done [[Books]]
		Getting things done [[Books]]
		`);
	});

	it('check for circular references', () => {
		const graph = fixture(`
		Project1.md
		- [[Task1]]
			- [[Note1]]
		`, `
		Task1.md
		- [[Note2]]
			- [[Project1]]	
		`)


		testSearchEquals(graph, 'project1', `
		[[Project1]]
		 [[Task1]]
		  [[Note1]]
		  [[Note2]]
		`);
		testSearchEquals(graph, 'task1', `
		[[Task1]]
		 [[Note1]]
		 [[Note2]]
		  [[Project1]]
		`);
	})

	it('aliases support', () => {
		const graph = fixture(`
			Note.md
			- [[Project|Alias]]
				 - [[Task2]]
			`, `
			Project.md,Alias
			- [[Task1]]
			`);

		testSearchEquals(graph, 'alias', `
			[[Project]] Alias
			 [[Project|Alias]]
			  [[Task2]]
			 [[Task1]]
			[[Alias]]
			[[Project|Alias]]
			`);
	})

	it('related notes dont appear in the graph', () => {
		const graph = fixture(`RelatedNote.md`, `
		Project.md
		- A related note about [[RelatedNote]]
		- [[DirectChild]]
		`)

		testSearchEquals(graph, 'Project', `
		[[Project]]
		 A related note about [[RelatedNote]]
		 [[DirectChild]]
		`);
		testSearchEquals(graph, 'Related', `
		[[RelatedNote]]
		 A related note about [[RelatedNote]]
		A related note about [[RelatedNote]]
		`);
	})

	it('tasks test', () => {
		const graph = fixture(`
		Project1.md
		- [ ] Task1
		- [x] Task2
		`)


		testSearchEquals(graph, 'project1', `
		[[Project1]]
		 [ ] Task1
		 [x] Task2
		`);
	})


	it('header refs support', () => {
		const graph = fixture(`
			Note.md
			- [[Project#TaskList]]
				 - [[Task2]]
			`,`
			AnotherNote.md
			- Inline Ref [[Project#TaskList]]
			`, `
			Project.md
			# TaskList
			- [[Task1]]
			`);

		testSearchContains(graph, 'TaskList', `
			**TaskList**
			 [[Project#TaskList]]
			  [[Task2]]
			 Inline Ref [[Project#TaskList]]
			 [[Task1]]
			[[Project#TaskList]]
			`);
	})

	it('header refs with parent search', async () => {
		const graph = fixture(`
			AnotherNote.md
			- Inline Ref [[Project#TaskList]]
			`, `
			Project.md
			# TaskList
			- [[Task1]]
			`);

		// await printGraph(graph);

		testSearchContains(graph, 'project > tasklist', `
			[[Project]]
			 **TaskList**
			  Inline Ref [[Project#TaskList]]
			  [[Task1]]
			`);
	})
});
