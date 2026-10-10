import http, {IncomingMessage, Server, ServerResponse} from "http";
import {Platform, type FileSystemAdapter} from "obsidian";
import {searchIndex, partitionArchived, parseQuery, extractArchiveReveal, flattenIndex, parseDuration} from "@mdtree/core";
import {getSettings, separatorAtom} from "../react-context/settings";
import fs from "fs";
import {createRaycastResponse, createRaycastTimelineResponse} from "../node-actions";
import {GlobalAtoms, GlobalStore} from "../react-context/global";
import {buildTimelineRows} from "../search/timeline-utils";

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

        // GET /?query=<q>&limit=<n>[&view=timeline[&window=7d|30d|1y]]
        // Tree rows by default; `view=timeline` returns the Search view's
        // Timeline rows, `window` being its recency chip (`in:` semantics).
        const requestListener = (req: IncomingMessage, res: ServerResponse) => {
            const params = new URL(req.url || "", "http://localhost").searchParams;
            const query = params.get("query");
            const limit = parseInt(params.get("limit") || "100");
            const decodedQuery = decodeURIComponent(query || "");

            if (!decodedQuery) {
                res.end("No query provided");
                return;
            }

            const app = this.store.get(GlobalAtoms.appAtom);
            const separator = this.store.get(separatorAtom);
            const graph = this.store.get(GlobalAtoms.graphAtom);
            const result = searchIndex(graph, decodedQuery, separator, this.store.get(GlobalAtoms.indexAtom)?.searchOptions());
            const { reveal, stages: matchExprs } = extractArchiveReveal(parseQuery(decodedQuery, separator))
            const { visible } = partitionArchived(result, reveal)
            const recency = params.get("window")
            // Raycast loads images from disk, not Obsidian's app:// resource URLs.
            const adapter = app.vault.adapter as FileSystemAdapter
            const mapped = params.get("view") === "timeline"
                ? createRaycastTimelineResponse(app,
                    buildTimelineRows(app, graph, visible, matchExprs, recency ? parseDuration(recency) : null).slice(0, limit),
                    f => adapter.getFullPath(f.path))
                : createRaycastResponse(app, flattenIndex(visible, 0, matchExprs).slice(0, limit))
            res.end(JSON.stringify(mapped));
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
