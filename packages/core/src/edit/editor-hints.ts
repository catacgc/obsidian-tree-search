import { linkOnlyTarget, parseOutline } from "./outline-edit.ts"
import { INVALID_NAME_RE } from "./attachments.ts"

export type EditorHint = { text: string; blocking: boolean }

const HEADING_RE = /^#{1,6}\s+\S/
const LINK_RE = /(?<!!)\[\[([^\]|#]+)/g
const NAMES_HINT = 'Names can\'t contain \\ / : * ? " < > |'
const PLAIN_HINT = "Plain bullets aren't indexed — they won't appear in results"

/** True when an Append outline adds nothing: no bullets, or only the untouched prefilled `- [[parentName]]` root. */
export function appendOutlineEmpty(outline: string, parentName?: string): boolean {
  const { lines } = parseOutline(outline)
  return (
    lines.length === 0 ||
    (!!parentName && lines.length === 1 && lines[0].depth === 0 && linkOnlyTarget(lines[0].text)?.toLowerCase() === parentName.toLowerCase())
  )
}

export function editorHints(input: {
  mode: "append" | "edit"
  editKind?: "list" | "heading"
  parentName: string
  outline: string
  contents: Record<string, string>
  contentOrder: string[]
  noteExists: (name: string) => boolean
  attachmentError?: { ambiguous: string } | { invalidName: string }
}): EditorHint[] {
  const { mode, outline, contents, noteExists, attachmentError } = input
  const blocking: string[] = []
  const block = (text: string) => {
    if (!blocking.includes(text)) blocking.push(text)
  }
  const headingHint = input.parentName
    ? `Headings go in a note's content — click [[${input.parentName}]]`
    : "Headings go in a note's content — click a [[link]]"

  let plain = false
  if (mode === "append") {
    const { issues } = parseOutline(outline)
    if (issues.some(i => i.kind === "heading")) block(headingHint)
    plain = issues.some(i => i.kind === "plain")
  } else {
    if (outline.trim() === "") block("Empty — use Archive to remove the line")
    else if (HEADING_RE.test(outline.trim())) block(headingHint)
    plain = input.editKind === "list" && !outline.includes("[[") && !outline.includes("#") && !outline.includes("http")
  }

  if (attachmentError) {
    if ("ambiguous" in attachmentError) {
      block(`Can't tell which attachment ![[${attachmentError.ambiguous}]] is — restore its file name and change the alias instead`)
    } else {
      block(NAMES_HINT)
    }
  }

  const bufferOf = (name: string): string | undefined => {
    if (name in contents) return contents[name]
    const lower = name.toLowerCase()
    const key = Object.keys(contents).find(k => k.toLowerCase() === lower)
    return key === undefined ? undefined : contents[key]
  }

  for (const [name, buf] of Object.entries(contents)) {
    if (buf.trim() !== "" && INVALID_NAME_RE.test(name) && !noteExists(name)) block(NAMES_HINT)
  }

  const info: string[] = []
  if (plain) info.push(PLAIN_HINT)

  const names: string[] = []
  const seen = new Set<string>()
  const addName = (raw: string) => {
    const name = raw.trim()
    if (!name || seen.has(name.toLowerCase())) return
    seen.add(name.toLowerCase())
    names.push(name)
  }
  for (const m of outline.matchAll(LINK_RE)) addName(m[1])
  for (const name of input.contentOrder) addName(name)

  const parentLower = input.parentName.toLowerCase()
  for (const name of names) {
    const hasBuffer = (bufferOf(name) ?? "").trim() !== ""
    if (!noteExists(name)) {
      if (hasBuffer) info.push(`Creates note "${name}"`)
      else if (name.toLowerCase() !== parentLower) info.push(`[[${name}]] stays a link without a note — click it to add content`)
    } else if (hasBuffer) {
      info.push(`Appends to ${name}.md`)
    }
  }

  return [...blocking.map(text => ({ text, blocking: true })), ...info.map(text => ({ text, blocking: false }))]
}
