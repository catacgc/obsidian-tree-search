import { Database } from "bun:sqlite"
import { mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { basename } from "node:path"
import type { NotesGraph } from "@mdtree/core"
import type { EdgeAttributes, Location, ParsedNode } from "@mdtree/core"
import type { VaultPluginConfig } from "../plugins/types.ts"
import { SCHEMA_SQL } from "./schema.ts"

// ── Path resolution ───────────────────────────────────────────────────────────

export function defaultDbPath(vaultName: string): string {
  const configDir = join(homedir(), ".config", "mdtree")
  mkdirSync(configDir, { recursive: true })
  return join(configDir, `${vaultName}.db`)
}

// ── Store ─────────────────────────────────────────────────────────────────────

export class VaultStore {
  private db: Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true })
    this.db.exec(SCHEMA_SQL)
    // WAL mode for better concurrent read performance
    this.db.exec("PRAGMA journal_mode=WAL")
    this.db.exec("PRAGMA synchronous=NORMAL")
    // Wait up to 5 s instead of immediately throwing SQLITE_BUSY
    this.db.exec("PRAGMA busy_timeout=5000")
    // Migrate existing DBs that predate the output_path column
    try {
      this.db.exec("ALTER TABLE plugin_config ADD COLUMN output_path TEXT")
    } catch {
      // column already exists — safe to ignore
    }
  }

  // ── Load ────────────────────────────────────────────────────────────────────

  hasData(vault: string): boolean {
    const row = this.db
      .query("SELECT COUNT(*) as cnt FROM nodes WHERE vault = ?")
      .get(vault) as { cnt: number }
    return row.cnt > 0
  }

  loadIntoGraph(vault: string, graph: NotesGraph): void {
    const nodes = this.db
      .query("SELECT key, data FROM nodes WHERE vault = ?")
      .all(vault) as { key: string; data: string }[]

    for (const row of nodes) {
      const node = JSON.parse(row.data) as ParsedNode
      graph.addOrUpdateNode(node)
    }

    const edges = this.db
      .query(
        "SELECT from_key, to_key, edge_type, mtime, location FROM edges WHERE vault = ?",
      )
      .all(vault) as {
      from_key: string
      to_key: string
      edge_type: string
      mtime: number
      location: string
    }[]

    for (const row of edges) {
      const loc = JSON.parse(row.location) as Location
      const attrs: EdgeAttributes = {
        type: row.edge_type as EdgeAttributes["type"],
        mtime: row.mtime,
        location: loc,
      }
      if (row.edge_type === "related") {
        graph.addRelatedEdge(row.from_key, row.to_key, loc, row.mtime)
      } else {
        // "parent" edges: reconstruct by looking up nodes and calling addChild
        const fromNode = graph.hasNode(row.from_key) ? graph.getNodeAttributes(row.from_key) : null
        const toNode = graph.hasNode(row.to_key) ? graph.getNodeAttributes(row.to_key) : null
        if (fromNode && toNode) {
          graph.addChild(fromNode, toNode, loc, row.mtime)
        }
      }
    }
  }

  // ── Staleness check ─────────────────────────────────────────────────────────

  /** Returns the Unix ms timestamp when this vault was last indexed, or 0 if unknown. */
  lastIndexed(vault: string): number {
    const row = this.db
      .query("SELECT last_indexed FROM meta WHERE vault = ?")
      .get(vault) as { last_indexed: number } | null
    return row?.last_indexed ?? 0
  }

  // ── Save (full vault) ───────────────────────────────────────────────────────

  saveGraph(vault: string, graph: NotesGraph): void {
    const insertNode = this.db.prepare(
      "INSERT OR REPLACE INTO nodes (vault, key, node_type, src_path, boost, age_days, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    const insertEdge = this.db.prepare(
      "INSERT INTO edges (vault, from_key, to_key, edge_type, src_path, mtime, location) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )

    // Clear existing data for this vault (parameterized to avoid injection)
    this.db.prepare("DELETE FROM nodes WHERE vault = ?").run(vault)
    this.db.prepare("DELETE FROM edges WHERE vault = ?").run(vault)

    const nodeKeys = graph.filterNodes(() => true)
    const insertNodes = this.db.transaction(() => {
      for (const key of nodeKeys) {
        const node = graph.getNodeAttributes(key)
        insertNode.run(vault, key, node.nodeType, node.location.path, node.boost ?? 0, node.ageDays ?? 0, JSON.stringify(node))
      }
    })
    insertNodes()

    const insertEdges = this.db.transaction(() => {
      for (const key of nodeKeys) {
        for (const edge of graph.outboundEdgeEntries(key)) {
          insertEdge.run(
            vault,
            edge.source,
            edge.target,
            edge.attributes.type,
            edge.attributes.location.path,
            edge.attributes.mtime,
            JSON.stringify(edge.attributes.location),
          )
        }
      }
    })
    insertEdges()

    // Record when this vault was last fully indexed
    this.db
      .prepare("INSERT OR REPLACE INTO meta (vault, last_indexed) VALUES (?, ?)")
      .run(vault, Date.now())
  }

  // ── Incremental update ──────────────────────────────────────────────────────

  deleteByPath(vault: string, srcPath: string): void {
    const del = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM nodes WHERE vault = ? AND src_path = ?")
        .run(vault, srcPath)
      this.db
        .prepare("DELETE FROM edges WHERE vault = ? AND src_path = ?")
        .run(vault, srcPath)
    })
    del()
  }

  insertNodes(vault: string, nodes: { key: string; node: ParsedNode }[]): void {
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO nodes (vault, key, node_type, src_path, boost, age_days, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    const tx = this.db.transaction(() => {
      for (const { key, node } of nodes) {
        stmt.run(vault, key, node.nodeType, node.location.path, node.boost ?? 0, node.ageDays ?? 0, JSON.stringify(node))
      }
    })
    tx()
  }

  insertEdges(
    vault: string,
    edges: {
      from: string
      to: string
      type: string
      srcPath: string
      mtime: number
      location: Location
    }[],
  ): void {
    const stmt = this.db.prepare(
      "INSERT INTO edges (vault, from_key, to_key, edge_type, src_path, mtime, location) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    const tx = this.db.transaction(() => {
      for (const e of edges) {
        stmt.run(vault, e.from, e.to, e.type, e.srcPath, e.mtime, JSON.stringify(e.location))
      }
    })
    tx()
  }

  // ── Plugin config ───────────────────────────────────────────────────────────

  getPluginConfig(vault: string, namespace: string): VaultPluginConfig {
    const row = this.db
      .query("SELECT enabled, config_json FROM plugin_config WHERE vault = ? AND namespace = ?")
      .get(vault, namespace) as { enabled: number; config_json: string } | null
    if (!row) return { enabled: true, configValues: {} }
    return {
      enabled: row.enabled !== 0,
      configValues: JSON.parse(row.config_json) as Record<string, unknown>,
    }
  }

  setPluginConfig(vault: string, namespace: string, config: VaultPluginConfig): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO plugin_config (vault, namespace, enabled, config_json) VALUES (?, ?, ?, ?)",
      )
      .run(vault, namespace, config.enabled ? 1 : 0, JSON.stringify(config.configValues))
  }

  setPluginEnabled(vault: string, namespace: string, enabled: boolean): void {
    this.db
      .prepare(
        "INSERT INTO plugin_config (vault, namespace, enabled, config_json) VALUES (?, ?, ?, '{}') " +
          "ON CONFLICT(vault, namespace) DO UPDATE SET enabled = excluded.enabled",
      )
      .run(vault, namespace, enabled ? 1 : 0)
  }

  setPluginOutputPath(vault: string, namespace: string, outputPath: string): void {
    this.db
      .prepare(
        "INSERT INTO plugin_config (vault, namespace, enabled, config_json, output_path) VALUES (?, ?, 1, '{}', ?) " +
          "ON CONFLICT(vault, namespace) DO UPDATE SET output_path = excluded.output_path",
      )
      .run(vault, namespace, outputPath)
  }

  listPluginConfigs(vault: string): { namespace: string; enabled: boolean; outputPath: string | null }[] {
    return (
      this.db
        .query("SELECT namespace, enabled, output_path FROM plugin_config WHERE vault = ?")
        .all(vault) as { namespace: string; enabled: number; output_path: string | null }[]
    ).map(r => ({ namespace: r.namespace, enabled: r.enabled !== 0, outputPath: r.output_path }))
  }

  listVaults(): string[] {
    const rows = this.db
      .query("SELECT DISTINCT vault FROM meta")
      .all() as { vault: string }[]
    return rows.map(r => r.vault)
  }

  close(): void {
    this.db.close()
  }
}
