import React from 'react';
import { createRoot } from 'react-dom/client';
import { createStore } from 'jotai';
import { NotesGraph } from '../graph';
import { GlobalAtoms } from '../view/react-context/global';
import { GraphContextProvider } from '../view/react-context/GraphContextProvider';
import { SearchModalContainer } from '../view/search-modal/SearchModalContainer';
import { createMockApp } from './mock-app';
import { updateSettings } from '../view/react-context/settings';

// Get socket path from settings (default)
const DEFAULT_SOCKET_PATH = '/tmp/tree-search-{vaultname}.sock';

async function fetchGraphData(socketPath: string): Promise<{ nodes: any[], edges: any[] }> {
    try {
        // For browser testing, we'll use a proxy or direct HTTP endpoint
        // Since Unix sockets aren't accessible from browsers, we need to use HTTP
        // For now, we'll use localhost with a port (this will need to be configured)

        // Try to fetch from a local HTTP server endpoint
        const response = await fetch('http://localhost:3000/graph', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Failed to fetch graph data:', error);
        throw error;
    }
}

function deserializeGraph(data: { nodes: any[], edges: any[] }): NotesGraph {
    const notesGraph = new NotesGraph();

    // Add all nodes
    for (const { key, attributes } of data.nodes) {
        notesGraph.graph.addNode(key, attributes);
    }

    // Add all edges
    for (const { source, target, attributes } of data.edges) {
        if (notesGraph.graph.hasNode(source) && notesGraph.graph.hasNode(target)) {
            notesGraph.graph.addDirectedEdge(source, target, attributes);
        }
    }

    return notesGraph;
}

async function main() {
    const container = document.getElementById('root');
    if (!container) {
        console.error('Root container not found');
        return;
    }

    // Show loading state
    container.innerHTML = '<div style="padding: 20px; text-align: center;">Loading graph data...</div>';

    try {
        // Fetch graph data from the server
        const graphData = await fetchGraphData(DEFAULT_SOCKET_PATH);
        console.log('Fetched graph data:', graphData.nodes.length, 'nodes,', graphData.edges.length, 'edges');

        // Deserialize into NotesGraph
        const notesGraph = deserializeGraph(graphData);

        // Create Jotai store
        const store = createStore();

        // Create mock app
        const mockApp = createMockApp();

        // Populate store with graph and app
        store.set(GlobalAtoms.appAtom, mockApp);
        store.set(GlobalAtoms.graphAtom, notesGraph);
        store.set(GlobalAtoms.isGraphLoadingAtom, false);

        // Set default settings
        updateSettings(store, {
            searchSeparator: '/',
            parentRelation: 'parent',
            archiveTag: 'archive',
            socketPath: DEFAULT_SOCKET_PATH
        });

        // Clear loading state and render React app
        container.innerHTML = '';
        const root = createRoot(container);

        root.render(
            <GraphContextProvider store={store}>
                <div className="tree-search-modal-container" style={{ height: '100vh' }}>
                    <div className="workspace-leaf-content">
                        <SearchModalContainer isQuickLink={false} />
                    </div>
                </div>
            </GraphContextProvider>
        );

        console.log('Browser test environment initialized successfully');
    } catch (error) {
        console.error('Failed to initialize browser test environment:', error);
        container.innerHTML = `
            <div style="padding: 20px; color: red;">
                <h2>Error Loading Graph Data</h2>
                <p>${error instanceof Error ? error.message : String(error)}</p>
                <p>Make sure:</p>
                <ul>
                    <li>Obsidian is running with the plugin loaded</li>
                    <li>The RaycastServer is running (check Obsidian console)</li>
                    <li>You have a proxy or HTTP server forwarding to the Unix socket</li>
                </ul>
            </div>
        `;
    }
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
