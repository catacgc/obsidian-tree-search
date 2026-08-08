/**
 * Field definitions for the Arc Browser plugin.
 * The CLI reads `fields` to build the interactive config prompt.
 * The `run.ts` entrypoint validates the incoming JSON itself.
 *
 * Each field has: name, type, description, optional secret/default/optional flags.
 */

export type FieldType = "string" | "number" | "boolean"

export interface FieldDef {
  name: string
  type: FieldType
  description: string
  secret?: boolean
  default?: unknown
  optional?: boolean
}

export const fields: FieldDef[] = [
  {
    name: "sidebarPath",
    type: "string",
    description:
      "Path to Arc's StorableSidebar.json (leave empty for the macOS default under ~/Library/Application Support/Arc)",
    optional: true,
  },
  {
    name: "spaces",
    type: "string",
    description: "Comma-separated Arc space titles to include (empty = all spaces)",
    optional: true,
  },
]
