import { App, TFile } from 'obsidian';
import { DvList } from './markdown';
import { Indexer } from './indexed-tree';
import { HeaderNode, NotesGraph, PageNode, ParsedNode, toLocation, Location } from 'src/graph';
import { TreeSearchSettings } from 'src/view/react-context/settings';
import { parseTextLines as createNodes } from './text-parser';

interface CanvasBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

type CanvasNode = {
  id: string;
  type: 'text' | 'file' | 'link' | 'group';
  color?: string;
  text?: string;
  file?: string;
  subpath?: string;
  url?: string;
  label?: string;
} & CanvasBox;

interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide: 'top' | 'right' | 'bottom' | 'left';
  toNode: string;
  toSide: 'top' | 'right' | 'bottom' | 'left';
  color?: string;
  label?: string;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

interface CanvasFile {
    data: CanvasData;
    path: string;
}

interface ParsedCanvasNode {
    block: CanvasNode;
    lines: NodeTextLine[];
}

interface ParsedCanvasFile {
    nodes: ParsedCanvasNode[];
    edges: CanvasEdge[];
    path: string;
    basename: string;
}

export interface NodeTextLine {
    text: string;
    location: Location;
    box: CanvasBox,
    parent?: NodeTextLine
    type: 'header'  | 'list'
    task?: 'task' | 'completed'
    indent: number
}

function parseNode(node: CanvasNode, path: string): ParsedCanvasNode {

    if (node.type == "file") {
        const basename = node.file?.split("/").pop()?.replace(".md", "") // TODO: not handling wikilinks yet
        return {
            block: node,
            lines: [
                {
                    text: `[[${basename}${node.subpath ? `${node.subpath}` : ''}]]`,
                    location: {
                        path: path,
                        position: {start: {line: 0, ch: 0}, end: {line: 0, ch: 0}},
                        canvasNode: node.id
                    },
                    box: {
                        x: node.x,
                        y: node.y,
                        width: node.width,
                        height: node.height
                    },
                    type: 'list',
                    indent: 1,
                }
            ]
        }
    }

    if (node.type == "group") {
        return {
            block: node,
            lines: [
                {
                    text: `${node.label}`,
                    location: {
                        path: path,
                        position: {start: {line: 0, ch: 0}, end: {line: 0, ch: 0}},
                        canvasNode: node.id
                    },
                    box: {
                        x: node.x,
                        y: node.y,
                        width: node.width,
                        height: node.height
                    },
                    type: 'header',
                    indent: 1,
                }
            ]
        }
    }


    if (!node.text) {
        return {
            block: node,
            lines: []
        }
    }

    const lines: NodeTextLine[] = node.text.split('\n')
        .filter(line => shouldInclude(line))
        .map((line, index) => {
            const headerMatch = line.match(/^(#+)\s*(.*)/);
            const listItemMatch = line.match(/^\s*(-|\*|\d+\.)\s*(.*)/);

            if (!headerMatch && !listItemMatch) {
                return null;
            }

            let effectiveIndent = 0;
            let task: 'task' | 'completed' | undefined = undefined;
            if (listItemMatch) {
                const trimmedLine = line.trimStart();
                effectiveIndent = line.length - trimmedLine.length;

                const listContent = listItemMatch[2];
                const isTask = listContent.startsWith('[ ]') || listContent.startsWith('[x]');
                const isCompleted = listContent.startsWith('[x]');
                task = isTask ? isCompleted ? 'completed' : 'task' : undefined;
            }

            if (headerMatch) {
                effectiveIndent = headerMatch[1].length;
            }

            const textLine: NodeTextLine = {
                text: line.replace(/^([#\-\s])+/, '').trim(),
                location: {
                    path: path,
                    position: {
                        start: { line: index, ch: 0 },
                        end: { line: index, ch: line.length }
                    },
                    canvasNode: node.id
                },
                box: {
                    x: node.x,
                    y: node.y,
                    width: node.width,
                    height: node.height
                },
                type: headerMatch ? 'header' : 'list',
                indent: effectiveIndent,
                task: task
            }

            return textLine
        }
        ).filter(line => line !== null)

    return {
        block: node,
        lines: lines
    }
}

export class CanvasIndexer implements Indexer<TFile> {
    constructor(private app: App) {
    }

    async index(source: TFile, graph: NotesGraph, settings: TreeSearchSettings): Promise<NotesGraph> {
        if (source.extension !== 'canvas') {
            return graph;
        }

        let canvasData: CanvasData;
        try {
            // Read the file content
            const content = await this.app.vault.read(source);
            
            // Parse the JSON content
            canvasData = JSON.parse(content) as CanvasData;
        } catch (error) {
            console.error('Error parsing canvas file:', error);
            return graph;
        }

        return parseCanvasData(source.path, source.basename, canvasData, graph)
    }
}

export function parseCanvasData(path: string, basename: string, canvasData: CanvasData, graph: NotesGraph): NotesGraph {
    // map the canvas text nodes to dvlist
    const canvas: CanvasFile = {data: canvasData, path: path};

    const parsed: ParsedCanvasFile = {
        nodes: canvas.data.nodes.map(node => parseNode(node, path)),
        edges: canvas.data.edges,
        path: path,
        basename: `${basename}.canvas` // obsidian chooses to have a different convention for canvas files
    }

    const withParents = addGroupParents(parsed)

    const pageNode = createCanvasNode(withParents, graph)

    for (const node of withParents.nodes) {
        createNodes(node.lines, pageNode, graph)
    }

    return graph;
}

function createCanvasNode(page: ParsedCanvasFile, graph: NotesGraph): PageNode {
    const node: PageNode = {
        nodeType: "page",
        isReference: false,
        page: page.basename,
        aliases: [],
        tags: [],
        location: {
            path: page.path,
            position: {start: {line: 0, ch: 0}, end: {line: 0, ch: 0}}
        },
        searchKey: `${page.basename}`.toLowerCase(),
    }

    graph.removeExistingPageEdges(node)
    graph.addOrUpdateNode(node)

    return node
}

function addGroupParents(parsed: ParsedCanvasFile): ParsedCanvasFile {
    for (const node of parsed.nodes) {
        const groupParent = parsed.nodes.find(groupCandidate =>{
            if (groupCandidate.block.type != 'group') {
                return false;
            }
    
            return groupCandidate.block.x < node.block.x && groupCandidate.block.x + groupCandidate.block.width > node.block.x + node.block.width
            && groupCandidate.block.y < node.block.y && groupCandidate.block.y + groupCandidate.block.height > node.block.y + node.block.height
        })

        node.lines = addParentsWithinNode(node.lines, groupParent?.lines[0])
    }

    return parsed;
}

function addParentsWithinNode(lines: NodeTextLine[], groupParent?: NodeTextLine): NodeTextLine[] {
    const headerStack: NodeTextLine[] = [];
    const lineStack: NodeTextLine[] = [];

    for (const line of lines) {
        let parentNode: NodeTextLine;

        if (line.type == 'header') {
            while (headerStack.length > 0 && headerStack[headerStack.length - 1].indent >= line.indent) {
                headerStack.pop();
            }

            line.parent = headerStack[headerStack.length - 1] || groupParent;

            headerStack.push(line);
            continue
        }

        while (lineStack.length > 0 && lineStack[lineStack.length - 1].indent >= line.indent) {
            lineStack.pop();
        }

        if (lineStack.length == 0 && headerStack.length > 0) {
            parentNode = headerStack[headerStack.length - 1];
        } else {
            parentNode = lineStack[lineStack.length - 1];
        }

        line.parent = parentNode || groupParent;
        lineStack.push(line);
    }

    return lines;
}

// not interested in plain text or random paragraphs
function shouldInclude(text: string) {
	return text.includes("[[")
		|| text.includes('http')
		|| text.includes('![[')
		|| text.includes('#')
        || text.includes('- [')
		;
}
