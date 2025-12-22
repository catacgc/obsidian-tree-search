import http, { IncomingMessage, Server, ServerResponse } from "http";
import { App, Platform } from "obsidian";
import { searchIndex } from "../../search/search";
import { flattenIndex } from "../react-context/state";
import { getSettings, separatorAtom } from "../react-context/settings";
import fs from "fs";
import { createRaycastResponse } from "./raycast-response";
import { GlobalStore } from "../react-context/global";
import { getDefaultInjector } from "bunshi";
import { GlobalAppMolecule } from "../react-context/global";

export class RaycastServer {
    private server: Server | null = null;
    private app: App;

    constructor(private readonly store: GlobalStore) {
        const { appAtom } = getDefaultInjector().get(GlobalAppMolecule)
        this.app = store.get(appAtom);
    }

    start() {
        this.createRaycastSocket();
    }

    stop() {
        this.server?.removeAllListeners();
        this.server?.close();

        this.deleteSocketFile(this.getSocketFileName());
    }

    private deleteSocketFile(socketFileName: string) {
        if (fs.existsSync(socketFileName)) {
            fs.unlink(socketFileName, (err: any) => {
                if (err) {
                    console.error(err)
                }
            });
        }
    }

    private getSocketFileName() {
        const vaultName = this.app.vault.getName()
        return getSettings(this.store).socketPath.replace("{vaultname}", vaultName);
    }

    createRaycastSocket() {
        if (!Platform.isDesktopApp || !Platform.isMacOS || Platform.isMobileApp || Platform.isMobile) return;

        if (this.server) {
            console.log("Server already running, skipping creation");
            return;
        }

        const requestListener = (req: IncomingMessage, res: ServerResponse) => {
            const url = new URL(req.url || "", "http://localhost");
            const pathname = url.pathname;

            // Set CORS headers for browser access
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.setHeader('Content-Type', 'application/json');

            // Handle OPTIONS preflight request
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            // Handle /graph endpoint - return full graph data
            if (pathname === '/graph') {
                try {
                    const { graphAtom } = getDefaultInjector().get(GlobalAppMolecule)
                    const graph = this.store.get(graphAtom);

                    // Serialize the graph data
                    const graphData = {
                        nodes: graph.graph.nodes().map(nodeKey => ({
                            key: nodeKey,
                            attributes: graph.graph.getNodeAttributes(nodeKey)
                        })),
                        edges: graph.graph.edges().map(edgeKey => {
                            const [source, target] = graph.graph.extremities(edgeKey);
                            return {
                                source,
                                target,
                                attributes: graph.graph.getEdgeAttributes(edgeKey)
                            };
                        })
                    };

                    res.writeHead(200);
                    res.end(JSON.stringify(graphData));
                } catch (error) {
                    console.error('Error serializing graph:', error);
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: 'Failed to serialize graph data' }));
                }
                return;
            }

            // Handle search endpoint (default behavior)
            const query = url.searchParams.get("query");
            const limit = parseInt(url.searchParams.get("limit") || "100");

            // decode the url
            const decodedQuery = decodeURIComponent(query || "");

            if (!decodedQuery) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: "No query provided" }));
                return;
            }

            const separator = this.store.get(separatorAtom);
            const { graphAtom } = getDefaultInjector().get(GlobalAppMolecule)
            const graph = this.store.get(graphAtom);
            const result = searchIndex(graph.graph, decodedQuery, separator);
            const flattened = flattenIndex(result)
            const mapped = createRaycastResponse(this.app, flattened.slice(0, limit))
            const jsonContent = JSON.stringify(mapped);
            res.writeHead(200);
            res.end(jsonContent);
        };

        try {
            this.server = http.createServer(requestListener);
            const socketFileName = this.getSocketFileName();

            this.deleteSocketFile(socketFileName);

            this.server.listen(socketFileName, () => {
                console.log("Server is Listening at Port " + socketFileName);
            });

            this.server.on('error', (err) => {
                console.error('Server error:', err);
                this.stop();
            });
        } catch (error) {
            console.error('Cannot start raycast:', error);
        }
    }
}
