// ── Plugin manifest (plugin.json) ─────────────────────────────────────────────

export interface PluginManifest {
  namespace: string
  name: string
  version: string
  description: string
  author?: string
  entrypoint: string
}

export interface InstalledPlugin extends PluginManifest {
  installPath: string
  installedAt: number
}

// ── Config field descriptor (exported by plugin as `fields`) ──────────────────

export type FieldType = "string" | "number" | "boolean"

export interface FieldDef {
  name: string
  type: FieldType
  description: string
  secret?: boolean
  default?: unknown
  optional?: boolean
}

// ── Per-vault plugin state ────────────────────────────────────────────────────

export interface VaultPluginConfig {
  enabled: boolean
  configValues: Record<string, unknown>
}
