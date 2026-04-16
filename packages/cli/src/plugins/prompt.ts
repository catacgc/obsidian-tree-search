import { createInterface } from "node:readline"
import type { FieldDef } from "./types.ts"

/**
 * Prompt the user for a single value.
 * Secret fields mask input with '*' characters.
 */
export function promptField(field: FieldDef, currentValue: unknown): Promise<string> {
  const hint = buildHint(field, currentValue)
  const label = `  ${field.description}${hint}: `

  if (field.secret) {
    return promptSecret(label)
  }
  return promptPlain(label)
}

function buildHint(field: FieldDef, currentValue: unknown): string {
  if (field.secret) {
    return currentValue !== undefined && currentValue !== "" ? " [currently set, Enter to keep]" : " [not set]"
  }
  const display = currentValue !== undefined ? currentValue : field.default
  return display !== undefined ? ` [${display}]` : ""
}

function promptPlain(label: string): Promise<string> {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(label, answer => {
      rl.close()
      resolve(answer)
    })
  })
}

function promptSecret(label: string): Promise<string> {
  return new Promise(resolve => {
    process.stdout.write(label)

    // Switch stdin to raw mode so we can intercept individual keystrokes
    process.stdin.setRawMode(true)
    process.stdin.resume()

    let value = ""

    function onData(buf: Buffer) {
      const ch = buf.toString("utf-8")

      // Ctrl+C
      if (ch === "\u0003") {
        cleanup()
        process.stdout.write("\n")
        process.exit(1)
      }

      // Enter
      if (ch === "\r" || ch === "\n") {
        cleanup()
        process.stdout.write("\n")
        resolve(value)
        return
      }

      // Backspace
      if (ch === "\u007f" || ch === "\b") {
        if (value.length > 0) {
          value = value.slice(0, -1)
          process.stdout.write("\b \b")
        }
        return
      }

      value += ch
      process.stdout.write("*")
    }

    function cleanup() {
      process.stdin.removeListener("data", onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
    }

    process.stdin.on("data", onData)
  })
}

/**
 * Prompt for every field in `fields`, returning a config values object.
 * For secret fields, an empty answer means "keep existing value".
 */
export async function promptAllFields(
  fields: FieldDef[],
  existing: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = { ...existing }

  for (const field of fields) {
    const raw = await promptField(field, existing[field.name])

    if (raw === "") {
      // Keep existing or use default
      if (result[field.name] === undefined && field.default !== undefined) {
        result[field.name] = field.default
      }
      continue
    }

    result[field.name] = coerce(raw, field)
  }

  return result
}

function coerce(raw: string, field: FieldDef): unknown {
  if (field.type === "boolean") return raw.toLowerCase() === "true" || raw === "1" || raw === "yes"
  if (field.type === "number") return Number(raw)
  return raw
}
