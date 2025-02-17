import {describe, expect, it} from "@jest/globals";
import {
    buildIndexFromFixture,
    expectSearch,
    fixture, result,
    search,
    testParentOf,
} from "./fixtures";
import {NotesGraph} from "../src/graph";
import { containsEmoji } from "../src/query";


async function printGraph(graph: NotesGraph) {
	const data = graph.graph.export();
	console.log(data)
}

describe('index and search operators', () => {
	it('should index the sample vault correctly', async () => {
		const graph1 = buildIndexFromFixture('ImportantProjects.md', `
		- [[Project1]]
		- [[Project2]]
				`);
		expect(graph1.graph.nodes()).toContain('[[importantprojects]]'); //lowercase keys
		expect(graph1.graph.nodes()).toContain('[[project1]]');
		expect(graph1.graph.nodes()).toContain('[[project2]]');
	});

	it('should search filenames', async () => {
		const nestedGraph = await fixture(`
		ImportantProjects.md
		- [[Project1]]
			- [[Task1]]
		- [[Project2]]
			- [[Task2]]
		`);


		expectSearch(nestedGraph, 'Important').toEqual(result(`
		[[ImportantProjects]]
		 [[Project1]]
		  [[Task1]]
		 [[Project2]]
		  [[Task2]]
		`));
	});

	it('should search nested', async () => {
		const nestedGraph = await fixture(`
		ImportantProjects.md
		- [[Project1]]
			- [[Task1]]
		- [[Project2]]
			- [[Task2]]
		`);
		expectSearch(nestedGraph, 'Important . Project2').toEqual(result(`
		[[ImportantProjects]]
		 [[Project2]]
		  [[Task2]]
		`));
	});

	it('not operator tree pruning', async () => {
		const graph = await fixture(`
			Projects.md
			- [[Project1]]
				- [[Task1]]
			- [[Project2]]
				- [[Task2]]
			`);
		
		expectSearch(graph, 'projects . -project1').toEqual(result(`
				[[Projects]]
				 [[Project2]]
				  [[Task2]]
				`));
		
		// expectSearch(graph, '-Project1').toEqual(result(`
		// 	[[ImportantProjects]]
		// 	 [[Project2]]
		// 	  [[Task2]]
		// 	`));

		// expectSearch(graph, '-Project1 -Project2').toEqual(result(`
		// 		[[ImportantProjects]]
		// 		`));
	})


	it('inline mentions', async () => {
		const inlineMentions = await fixture(`Topic1.md`, `
			ImportantProjects.md
			- [[Project1]]
			- [[Project1]] with an inline mention
				- Task1 related to [[Topic1]]
			- [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
			`);

		expectSearch(inlineMentions, 'Topic1 -topic2').toEqual(result(`
			[[Topic1]]
			 Task1 related to [[Topic1]]
			 [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
			`));

		expectSearch(inlineMentions, 'Project1').toEqual(result(`
			[[Project1]]
			 [[Project1]] with an inline mention
			  Task1 related to [[Topic1]]
			`));
	})

	it('references', async () => {
		const inlineMentions = await fixture(`
		ImportantProjects.md
		- [[Project1]]
			- [[Project1]] with an inline mention
				- Task1 related to [[Topic1]]
		- [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
		`);

		expectSearch(inlineMentions, 'important').toEqual(result(`
		[[ImportantProjects]]
		 [[Project1]]
		  [[Project1]] with an inline mention
		   Task1 related to [[Topic1]]
		 [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
		`));
	})

	it('find nested references', async () => {
		const graph = await fixture(`
		DailyNote.md
		- [[Project1]]
		- [[Project1]] with an inline mention
			- Task1 related to [[Topic1]]
		- [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
`);

		expectSearch(graph, 'topic1').toEqual(result(`
		[[Topic1]]
		 Task1 related to [[Topic1]]
		 [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
		`));

		expectSearch(graph, 'topic2').toEqual(result(`
		[[Topic2]]
		 [[Project2]] with a mention of a few topics [[Topic1]] [[Topic2]]
		`));
	})

	it('index books reference as its own tree ', async () => {
		const graph = await fixture(`
		Random.md
		- Getting things done [[Books]]
		`)

		expectSearch(graph, 'Books').toEqual(result(`
		[[Books]]
		 Getting things done [[Books]]
		`));
	});

	it('check for circular references', async () => {
		const graph = await fixture(`
		Project1.md
		- [[Task1]]
			- [[Note1]]
		`, `
		Task1.md
		- [[Note2]]
			- [[Project1]]	
		`)


		expectSearch(graph, 'project1').toEqual(result(`
		[[Project1]]
		 [[Task1]]
		  [[Note1]]
		  [[Note2]]
		   [[Project1]]
		`));
		expectSearch(graph, 'task1').toEqual(result(`
		[[Task1]]
		 [[Note1]]
		 [[Note2]]
		  [[Project1]]
		   [[Task1]]
		`));
	})

	it('emoji search', async () => {
		const graph = await fixture(`
			Note.md
			- [[Project]]
				 - test 🪴 https://www.evergreen.com
			`);

		expect(containsEmoji('test 🪴')).toBe(true);

		expectSearch(graph, ':emoji').toEqual(result(`
			test 🪴 https://www.evergreen.com
			`));
	});

	it('aliases support', async () => {
		const graph = await fixture(`
			Note.md
			- [[Project|Alias]]
				 - [[Task2]]
			`, `
			Project.md,{"aliases": ["Alias"]}
			- [[Task1]]
			`);

		expectSearch(graph, 'alias').toEqual(result(`
			[[Project]] Alias
			 [[Task2]]
			 [[Task1]]
			`));
	})

	it('related notes dont appear in the graph', async () => {
		const graph = await fixture(`RelatedNote.md`, `
		Project.md
		- A related note about [[RelatedNote]]
		- [[DirectChild]]
		`)

		expectSearch(graph, 'Project').toEqual(result(`
		[[Project]]
		 A related note about [[RelatedNote]]
		 [[DirectChild]]
		`));
		expectSearch(graph, 'Related').toEqual(result(`
		[[RelatedNote]]
		 A related note about [[RelatedNote]]
		`));
	})

	it('tasks test', async () => {
		const graph = await fixture(`
		Project1.md
		- [ ] Task1
		- [x] Task2
		`)


		expectSearch(graph, 'project1').toEqual(result(`
		[[Project1]]
		 [ ] Task1
		 [x] Task2
		`));
	})


	it('header refs support', async () => {
		const graph = await fixture(`
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

		testParentOf(graph, '[[Note]]', 'Project#TaskList');

		expectSearch(graph, 'TaskList').toContain(result(`
			Project#TaskList
			 [[Task2]]
			 Inline Ref [[Project#TaskList]]
			 [[Task1]]`));
	})

	it('header refs with parent search', async () => {
		const graph = await fixture(`
			AnotherNote.md
			- Inline Ref [[Project#TaskList]]
			`, `
			Project.md
			# TaskList
			- [[Task1]]
			`);

		// await printGraph(graph);

		expectSearch(graph, 'project . tasklist').toContain(result(`
			[[Project]]
			 Project#TaskList
			  Inline Ref [[Project#TaskList]]
			  [[Task1]]
			`));
	})

	it('search header and page modifiers', async () => {
		const graph = await fixture(`
			Note1.md
			- [[Note2]]
				- http://www.example.com
			- [[Note3]]
			`, `
			Note2.md
			# Header1
			`);

		expectSearch(graph, 'note1 . :page').toContain(result(`
			[[Note1]]
			 [[Note2]]
			 [[Note3]]
			`));
		
		expectSearch(graph, 'note1 . :header').toContain(result(`
			[[Note1]]
			 [[Note2]]
			  Note2#Header1
			`));

		expectSearch(graph, 'note1 . :header | :page').toContain(result(`
			[[Note1]]
			 [[Note2]]
			  Note2#Header1
			 [[Note3]]
			`));
	})


	it("graph headers", async () => {
        let graph = await fixture(`
		Page
		# Header
		- [[TEST#H1|B]] with [[TEST#H1|C]]
		`)

        const res = search(graph, "TEST")
		expect(res).toContain(result(`
		[[TEST]] B C
		 TEST#H1
		  [[TEST#H1|B]] with [[TEST#H1|C]]
		`))
    })

	it('search by file reference', async () => {
		const graph = await fixture(`
			Note.md
			- [[A]]
		`, `Note2.md
			- [[B]]`)

		expectSearch(graph, '"Note| :page').toEqual(result(`
		[[Note]]
		 [[A]]
		`))
	})

});
