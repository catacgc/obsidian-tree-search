import { parseTextLines } from '../../src/indexing/text-parser';
import { describe, it, expect } from '@jest/globals';
import { HeaderNode, Location, PageNode, ParsedNode, ParsedTextToken, TextNode, TextToken } from '../../src/graph';
import { NotesGraph } from '../../src/graph';

/**
 * Test fixture to create a graph from text
 */
function parseText(text: string, filePath: string = 'example.md', pageName: string = 'Example Page'): NotesGraph {
    // Create a page node to serve as the root
    const pageNode: PageNode = {
        nodeType: "page",
        isReference: false,
        page: pageName,
        aliases: [],
        tags: [],
        location: {
            path: filePath,
            position: {
                start: { line: 0, ch: 0 },
                end: { line: 0, ch: 0 }
            }
        },
        searchKey: pageName.toLowerCase()
    };
    
    // Split the text into lines
    const lines = text.split('\n').map(line => ({
        text: line,
        location: {
            path: filePath,
            position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } }
        }
    }));
    
    // Create a new graph and parse the lines
    return parseTextLines(lines, pageNode, new NotesGraph());
}

describe('Text Parser', () => {
    it('should parse headers and list items correctly', () => {
        // Example text with headers and list items
        const exampleText = `# H1
- l1
 - l2
  - l3
 -l4
## H2
### H3
- l5`;

        // Parse the text into a graph
        const graph = parseText(exampleText);

        // Verify the graph structure
        expect(graph.graph.order).toBe(9); // 1 page + 3 headers + 5 list items
        expect(graph.graph.size).toBe(8); // Each node except page has one parent

        // Verify header hierarchy
        expect(graph.graph.hasEdge('[[example page]]', 'example page#h1')).toBeTruthy();
        expect(graph.graph.hasEdge('example page#h1', 'example page#h2')).toBeTruthy();
        expect(graph.graph.hasEdge('example page#h2', 'example page#h3')).toBeTruthy();

        // Verify list item relationships using direct node keys
        expect(graph.graph.hasEdge('example page#h1', 'l1')).toBeTruthy();
        expect(graph.graph.hasEdge('l1', 'l2')).toBeTruthy();
        expect(graph.graph.hasEdge('l2', 'l3')).toBeTruthy();
    });

    it('should parse task items correctly', () => {
        const exampleText = `# Tasks
- [ ] Task not completed
- [x] Task completed`;

        const graph = parseText(exampleText);

        // Verify task nodes are connected to the header
        expect(graph.graph.hasEdge('example page#tasks', '[ ] task not completed')).toBeTruthy();
        expect(graph.graph.hasEdge('example page#tasks', '[x] task completed')).toBeTruthy();

        // Verify task completion status
        const notCompletedNode = graph.graph.getNodeAttributes('[ ] task not completed') as TextNode;
        const completedNode = graph.graph.getNodeAttributes('[x] task completed') as TextNode;
        expect(notCompletedNode.isCompleted).toBeFalsy();
        expect(completedNode.isCompleted).toBeTruthy();
    });

    it('should handle nested list items with proper parent-child relationships', () => {
        const exampleText = `# List
- Parent 1
  - Child 1
    - Grandchild 1
  - Child 2
- Parent 2
  - Child 3`;

        const graph = parseText(exampleText);

        // Verify relationships using direct node keys
        expect(graph.graph.hasEdge('example page#list', 'parent 1')).toBeTruthy();
        expect(graph.graph.hasEdge('parent 1', 'child 1')).toBeTruthy();
        expect(graph.graph.hasEdge('child 1', 'grandchild 1')).toBeTruthy();
        expect(graph.graph.hasEdge('parent 1', 'child 2')).toBeTruthy();
        expect(graph.graph.hasEdge('example page#list', 'parent 2')).toBeTruthy();
        expect(graph.graph.hasEdge('parent 2', 'child 3')).toBeTruthy();
    });

    it('should handle header hierarchy correctly', () => {
        const exampleText = `# H1
## H1.1
### H1.1.1
## H1.2
# H2
## H2.1`;

        const graph = parseText(exampleText);

        // Verify header hierarchy
        expect(graph.graph.hasEdge('[[example page]]', 'example page#h1')).toBeTruthy();
        expect(graph.graph.hasEdge('[[example page]]', 'example page#h2')).toBeTruthy();
        expect(graph.graph.hasEdge('example page#h1', 'example page#h1.1')).toBeTruthy();
        expect(graph.graph.hasEdge('example page#h1.1', 'example page#h1.1.1')).toBeTruthy();
        expect(graph.graph.hasEdge('example page#h1', 'example page#h1.2')).toBeTruthy();
        expect(graph.graph.hasEdge('example page#h2', 'example page#h2.1')).toBeTruthy();

        // Verify that sub-headers are not directly connected to page
        expect(graph.graph.hasEdge('[[example page]]', 'example page#h1.1')).toBeFalsy();
        expect(graph.graph.hasEdge('[[example page]]', 'example page#h1.1.1')).toBeFalsy();
        expect(graph.graph.hasEdge('[[example page]]', 'example page#h1.2')).toBeFalsy();
        expect(graph.graph.hasEdge('[[example page]]', 'example page#h2.1')).toBeFalsy();
    });

}); 