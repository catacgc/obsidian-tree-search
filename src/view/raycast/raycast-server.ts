import http, {IncomingMessage, Server, ServerResponse} from "http";
import {App, Platform} from "obsidian";
import {searchIndex} from "../../search/search";
import {flattenIndex} from "../react-context/state";
import {getSettings, separatorAtom} from "../react-context/settings";
import fs from "fs";
import {createRaycastResponse} from "./raycast-response";
import {GlobalAtoms, GlobalStore} from "../react-context/global";

export class RaycastServer {
    private server: Server | null = null;
    private app: App;

    constructor(private readonly store: GlobalStore) {
        this.app = store.get(GlobalAtoms.appAtom);
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
            // parse query parameters from url
            const query = new URL(req.url || "", "http://localhost").searchParams.get("query");
            const limit = parseInt(new URL(req.url || "", "http://localhost").searchParams.get("limit") || "100");

            // decode the url
            const decodedQuery = decodeURIComponent(query || "");

            if (!decodedQuery) {
                res.end("No query provided  ");
            }


            const separator = this.store.get(separatorAtom);
            const graph = this.store.get(GlobalAtoms.graphAtom);
            const result = searchIndex(graph.graph, decodedQuery, separator);
            const flattened = flattenIndex(result)
            const mapped = createRaycastResponse(this.app, flattened.slice(0, limit))
            const jsonContent = JSON.stringify(mapped);
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
