import { searchIndex, flattenIndex, parseQuery, partitionArchived, type NotesGraph } from "@mdtree/core"
import type { IndexSettings } from "@mdtree/core"
import { createVaultResults, type VaultResults } from "./response.ts"
import { unlinkSync, existsSync } from "node:fs"
import type { Server } from "bun"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyServer = Server<any>

// ── VaultIndex ────────────────────────────────────────────────────────────────

export type VaultIndex = {
  graph: NotesGraph
  settings: IndexSettings
  vaultName: string
}

// ── Request handler ───────────────────────────────────────────────────────────

function handleRequest(req: Request, vault: VaultIndex): Response {
  const url = new URL(req.url)
  const query = decodeURIComponent(url.searchParams.get("query") ?? "")
  const limit = parseInt(url.searchParams.get("limit") ?? "100", 10)

  if (!query) {
    const body: VaultResults = { vault: vault.vaultName, results: [] }
    return Response.json(body)
  }

  try {
    const results = searchIndex(vault.graph, query, vault.settings.searchSeparator)
    const { visible, archivedCount } = partitionArchived(results)
    const matchExprs = parseQuery(query, vault.settings.searchSeparator)
    const flattened = flattenIndex(visible, 0, matchExprs).slice(0, limit)
    const response = createVaultResults(vault.vaultName, flattened, archivedCount)
    return Response.json(response)
  } catch (err) {
    const body: VaultResults = {
      vault: vault.vaultName,
      results: [],
      error: String(err),
    }
    return Response.json(body, { status: 500 })
  }
}

// ── Server creation ───────────────────────────────────────────────────────────

export type ServerOptions = {
  socketPath?: string  // Unix socket path (default)
  port?: number        // TCP port (opt-in)
}

export function startServer(vault: VaultIndex, opts: ServerOptions = {}): AnyServer {
  const socketPath =
    opts.socketPath ?? `/tmp/mdtree-${vault.vaultName}.sock`

  // Clean up stale socket file
  if (!opts.port && existsSync(socketPath)) {
    try { unlinkSync(socketPath) } catch {}
  }

  const serverOpts = opts.port
    ? {
        port: opts.port,
        fetch(req: Request) {
          return handleRequest(req, vault)
        },
      }
    : {
        unix: socketPath,
        fetch(req: Request) {
          return handleRequest(req, vault)
        },
      }

  const server = Bun.serve(serverOpts)

  if (opts.port) {
    console.log(`[${vault.vaultName}] Listening on port ${opts.port}`)
  } else {
    console.log(`[${vault.vaultName}] Listening on ${socketPath}`)
  }

  return server
}
