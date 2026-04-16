/**
 * Field definitions for the Todoist plugin.
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
    name: "apiToken",
    type: "string",
    description: "Todoist API token (Settings → Integrations → Developer)",
    secret: true,
  },
  {
    name: "includePersonalInbox",
    type: "boolean",
    description: "Include tasks from the Inbox project (true/false)",
    default: true,
  },
]
