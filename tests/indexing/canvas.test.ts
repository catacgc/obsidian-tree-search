import { describe, expect, it } from '@jest/globals';
import { NotesGraph, TextNode } from '../../src/graph';
import { CanvasData, parseCanvasData } from '../../src/indexing/canvas';

/**
 * Test fixture to create a graph from text
 */
function parseCanvas(text: string, filePath: string = 'example.md', pageName: string = 'Example Page'): NotesGraph {
    const canvasData: CanvasData = {
        nodes: [
            {
                type: 'text',
                text: text,
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                id: '1'
            }
        ],
        edges: []
    }

    return parseCanvasData(filePath, pageName, canvasData, new NotesGraph())
}

describe('Text Parser', () => {
    it('should parse headers and list items correctly', () => {
        // Example text with headers and list items
        const exampleText = `# H1
- l1 #tag
 - l2 #tag
  - l3 #tag
 - l4 #tag
## H2
### H3
- l5 #tag`;

        // Parse the text into a graph
        const graph = parseCanvas(exampleText);

        // Verify the graph structure
        expect(graph.graph.order).toBe(9); // 1 page + 3 headers + 5 list items
        expect(graph.graph.size).toBe(8); // Each node except page has one parent

        // Verify header hierarchy
        expect(graph.graph.hasEdge('[[example page]]', 'example page.canvas#h1')).toBeTruthy();
        expect(graph.graph.hasEdge('example page.canvas#h2', 'example page.canvas#h3')).toBeTruthy();
        expect(graph.graph.hasEdge('example page.canvas#h1', 'example page.canvas#h2')).toBeTruthy();

        // Verify list item relationships using direct node keys
        expect(graph.graph.hasEdge('example page.canvas#h1', 'l1 #tag')).toBeTruthy();
        expect(graph.graph.hasEdge('l1 #tag', 'l2 #tag')).toBeTruthy();
        expect(graph.graph.hasEdge('l2 #tag', 'l3 #tag')).toBeTruthy();
        expect(graph.graph.hasEdge('example page.canvas#h3', 'l5 #tag')).toBeTruthy();
    });

    it('should parse task items correctly', () => {
        const exampleText = `
# Tasks        
- [ ] Task not completed
- [x] Task completed`;

        const graph = parseCanvas(exampleText);

        // Verify task nodes are connected to the header
        expect(graph.graph.hasEdge('example page.canvas#tasks', '[ ] task not completed')).toBeTruthy();
        expect(graph.graph.hasEdge('example page.canvas#tasks', '[x] task completed')).toBeTruthy();

        // Verify task completion status
        const notCompletedNode = graph.graph.getNodeAttributes('[ ] task not completed') as TextNode;
        const completedNode = graph.graph.getNodeAttributes('[x] task completed') as TextNode;
        expect(notCompletedNode.isCompleted).toBeFalsy();
        expect(completedNode.isCompleted).toBeTruthy();
    });

    it('should handle header hierarchy correctly', () => {
        const exampleText = `# H1
## H1.1
### H1.1.1
## H1.2
# H2
## H2.1`;

        const graph = parseCanvas(exampleText);

        // Verify header hierarchy
        expect(graph.graph.hasEdge('[[example page]]', 'example page.canvas#h1')).toBeTruthy();
        expect(graph.graph.hasEdge('[[example page]]', 'example page.canvas#h2')).toBeTruthy();
        expect(graph.graph.hasEdge('example page.canvas#h1', 'example page.canvas#h1.1')).toBeTruthy();
        expect(graph.graph.hasEdge('example page.canvas#h1.1', 'example page.canvas#h1.1.1')).toBeTruthy();
        expect(graph.graph.hasEdge('example page.canvas#h1', 'example page.canvas#h1.2')).toBeTruthy();
        expect(graph.graph.hasEdge('example page.canvas#h2', 'example page.canvas#h2.1')).toBeTruthy();

        // Verify that sub-headers are not directly connected to page
        expect(graph.graph.hasEdge('[[example page]]', 'example page.canvas#h1.1')).toBeFalsy();
        expect(graph.graph.hasEdge('[[example page]]', 'example page.canvas#h1.1.1')).toBeFalsy();
        expect(graph.graph.hasEdge('[[example page]]', 'example page.canvas#h1.2')).toBeFalsy();
        expect(graph.graph.hasEdge('[[example page]]', 'example page.canvas#h2.1')).toBeFalsy();
    });

}); 