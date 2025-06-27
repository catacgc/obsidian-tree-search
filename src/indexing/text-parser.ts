import { HeaderNode, Location, ObsidianLinkToken, PageNode, ParsedNode, TextNode, toLocation } from 'src/graph';
import { parseTokens } from './parser';
import { NotesGraph } from '../graph';
import { NodeTextLine } from './canvas';

/**
 * Parses a set of text lines into a hierarchy of ParsedNodes
 * @param lines Array of text lines pre-split by newline
 * @param pageNode The page node to use as the root
 * @param graph The graph to add nodes and relationships to
 * @returns The graph with added nodes and relationships
 */
export function parseTextLines(lines: NodeTextLine[], pageNode: PageNode, graph: NotesGraph): NotesGraph {
    
    // Process each line
    for (const line of lines) {
        // Skip empty lines
        if (line.text.trim().length === 0) {
            continue;
        }

        createNode(pageNode, line, graph)
    }

    return graph;
}

function createNode(pageNode: PageNode, line: NodeTextLine, graph: NotesGraph) {
    let parent = line.parent ? createNode(pageNode, line.parent, graph) : pageNode;
    
    let node;
    if (line.type == 'header') {
        node = createHeaderNode(pageNode.page, line.text, line.location, line.indent);
    } else {
        node = createNodeFromText(graph,
            line.text,
            line.location, line.task == 'task' || line.task == 'completed',
            line.task == 'completed',
            pageNode.ageDays);
    }

    graph.addOrUpdateNode(node)
    graph.addChild(parent, node, node.location, 0)
    return node;
}

/**
 * Creates a header node
 */
function createHeaderNode(page: string, header: string, location: Location, indent: number): HeaderNode {
    return {
        nodeType: "header",
        page: page,
        header: header,
        indent: indent,
        location: location,
        searchKey: `${page}#${header}`.toLowerCase(),
        boost: 0, // Default boost for text-parser created headers
        ageDays: 0 // Default age for text-parser created headers
    };
}

function createNodeFromText(graph: NotesGraph, text: string,
                            location: Location, isTask: boolean,
                            isCompleted: boolean, ageDays: number): TextNode | PageNode | HeaderNode {
    const parsed = parseTokens(text)

    const obsidianLinkReference: ObsidianLinkToken[] = graph.getObsidianLinkReference(parsed);

    // if this is just a page reference, then skip the text node
    if (obsidianLinkReference.length == 1 && obsidianLinkReference[0].source == text) {
        return graph.createVirtualPage(obsidianLinkReference[0], location, ageDays)
    }

    let textNode: TextNode = {
        location: location,
        searchKey: text.toLowerCase(),
        parsedTokens: parsed,
        nodeType: "text",
        // tokens: tokens,
        tags: [],
        isTask: isTask,
        isCompleted: isCompleted,
        boost: 0, // Default boost for text-parser created text nodes
        ageDays: ageDays
    }

    graph.addOrUpdateNode(textNode)

    // make all reference nodes, parents of the text node
    const parentsFromRefs = graph.createRefsNodes(obsidianLinkReference, textNode, ageDays);
    parentsFromRefs.forEach(it => graph.addChild(it, textNode, textNode.location, ageDays))

    return textNode;
}
