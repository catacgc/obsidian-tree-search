import http, {IncomingMessage, Server, ServerResponse} from "http";
import {Platform} from "obsidian";
import {searchIndex} from "@mdtree/core";
import {flattenIndex} from "../react-context/state";
import {getSettings, separatorAtom} from "../react-context/settings";
import fs from "fs";
import {createRaycastResponse} from "../node-actions";
import {GlobalAtoms, GlobalStore} from "../react-context/global";

export class RaycastServer {
    private server: Server | null = null;

    constructor(private readonly store: GlobalStore) {}

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
        const app = this.store.get(GlobalAtoms.appAtom);
        const vaultName = app.vault.getName()
        return getSettings(this.store).socketPath.replace("{vaultname}", vaultName);
    }

    createRaycastSocket() {
        if (!Platform.isDesktopApp || !Platform.isMacOS || Platform.isMobileApp || Platform.isMobile) return;

        if (this.server) {
            console.log("Server already running, skipping creation");
            return;
        }

        const requestListener = (req: IncomingMessage, res: ServerResponse) => {
            const query = new URL(req.url || "", "http://localhost").searchParams.get("query");
            const limit = parseInt(new URL(req.url || "", "http://localhost").searchParams.get("limit") || "100");
            const decodedQuery = decodeURIComponent(query || "");

            if (!decodedQuery) {
                res.end("No query provided");
                return;
            }

            const app = this.store.get(GlobalAtoms.appAtom);
            const separator = this.store.get(separatorAtom);
            const graph = this.store.get(GlobalAtoms.graphAtom);
            const result = searchIndex(graph, decodedQuery, separator);
            const flattened = flattenIndex(result)
            const mapped = createRaycastResponse(app, flattened.slice(0, limit))
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
