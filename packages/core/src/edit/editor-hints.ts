import { parseOutline } from "./outline-edit.ts"
import { describePatch, type NotePatch } from "./note-patches.ts"
import { INVALID_NAME_RE } from "./attachments.ts"

export type EditorHint = { text: string; blocking: boolean }

const HEADING_RE = /^#{1,6}\s+\S/
const LINK_RE = /(?<!!)\[\[([^\]|#]+)/g
export const NAMES_HINT = 'Names can\'t contain \\ / : * ? " < > |'
export const PLAIN_HINT = "Plain bullets aren't indexed — they won't appear in results"

/** True when an Append outline adds nothing: no bullets, or only the untouched prefilled `- [[parentName]]` root. */
export function appendOutlineEmpty(outline: string, parentName?: string): boolean {
  const { lines } = parseOutline(outline)
  return (
    lines.length === 0 ||
    (!!parentName && lines.length === 1 && lines[0].depth === 0 && lines[0].text.toLowerCase() === `[[${parentName}]]`.toLowerCase())
  )
}

/** Hints for renaming a file (Rename on an attachment row): `stem` is the new name without `extension`; `original` is
 *  the current file name. A case-only change of the same file is allowed. */
export function renameFileHints(stem: string, original: string, extension: string, fileExists: (name: string) => boolean): EditorHint[] {
  const name = stem.trim()
  const block = (text: string): EditorHint[] => [{ text, blocking: true }]
  if (name === "") return block("Name the file")
  if (INVALID_NAME_RE.test(name)) return block(NAMES_HINT)
  const next = extension ? `${name}.${extension}` : name
  if (next.toLowerCase() !== original.toLowerCase() && fileExists(next)) return block(`"${next}" already exists`)
  return []
}

export function editorHints(input: {
  mode: "append" | "edit" | "prose"
  editKind?: "list" | "heading"
  parentName: string
  outline: string
  /** Edit mode: the edited line's marker prefix (indent, bullet, checkbox); default `- `. */
  linePrefix?: string
  contents: Record<string, string>
  contentOrder: string[]
  noteExists: (name: string) => boolean
  attachmentError?: { ambiguous: string } | { invalidName: string }
  /** Prose mode for a new note: the name field's value. */
  proseNewName?: string
  /** Prose mode: the save would change the note's frontmatter or leading outline. */
  proseOutlineChanged?: boolean
  /** Prose mode: the outline change was confirmed by a first Save. */
  proseConfirmed?: boolean
  /** Append mode: the outline's note patches (planOutlinePatches). */
  patches?: NotePatch[]
}): EditorHint[] {
  const { mode, outline, contents, noteExists, attachmentError } = input
  const blocking: string[] = []
  const block = (text: string) => {
    if (!blocking.includes(text)) blocking.push(text)
  }
  const headingHint = input.parentName
    ? `Headings go in a note's content — click [[${input.parentName}]]`
    : "Headings go in a note's content — click a [[link]]"

  const info: string[] = []
  let plain = false
  if (mode === "prose") {
    if (outline.trim() === "") block("Empty — nothing to save")
    if (input.proseNewName !== undefined) {
      const name = input.proseNewName.trim()
      if (name === "") block("Name the new note")
      else if (INVALID_NAME_RE.test(name)) block(NAMES_HINT)
      else if (noteExists(name)) block(`Note "${name}" already exists`)
    }
    if (input.proseOutlineChanged) {
      info.push(input.proseConfirmed
        ? "Outline changes confirmed — Save writes them"
        : "This changes the note's outline or frontmatter — press Save twice to confirm")
    }
  } else if (mode === "append") {
    const { issues } = parseOutline(outline)
    if (issues.some(i => i.kind === "heading")) block(headingHint)
  } else {
    if (outline.trim() === "") block("Empty — use Archive to remove the line")
    else if (HEADING_RE.test(outline.trim())) block(headingHint)
    plain = input.editKind === "list" && parseOutline((input.linePrefix ?? "- ") + outline.replace(/\r?\n/g, " ")).issues.some(i => i.kind === "plain")
  }

  if (attachmentError) {
    if ("ambiguous" in attachmentError) {
      block(`Can't tell which attachment ![[${attachmentError.ambiguous}]] is — restore its file name and change the alias instead`)
    } else {
      block(NAMES_HINT)
    }
  }

  if (mode === "prose") return [...blocking.map(text => ({ text, blocking: true })), ...info.map(text => ({ text, blocking: false }))]

  const bufferOf = (name: string): string | undefined => {
    if (name in contents) return contents[name]
    const lower = name.toLowerCase()
    const key = Object.keys(contents).find(k => k.toLowerCase() === lower)
    return key === undefined ? undefined : contents[key]
  }

  for (const [name, buf] of Object.entries(contents)) {
    if (buf.trim() !== "" && INVALID_NAME_RE.test(name) && !noteExists(name)) block(NAMES_HINT)
  }

  if (plain) info.push(PLAIN_HINT)
  const patched = new Set((input.patches ?? []).map(p => p.name.toLowerCase()))
  for (const p of input.patches ?? []) info.push(...describePatch(p, noteExists(p.name)))
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
    if (patched.has(name.toLowerCase())) {
      if (hasBuffer && noteExists(name)) info.push(`Appends to ${name}.md`)
      continue
    }
    if (!noteExists(name)) {
      if (hasBuffer) info.push(`Creates note "${name}"`)
      else if (name.toLowerCase() !== parentLower) info.push(`[[${name}]] stays a link without a note — click it to add content`)
    } else if (hasBuffer) {
      info.push(`Appends to ${name}.md`)
    }
  }

  return [...blocking.map(text => ({ text, blocking: true })), ...info.map(text => ({ text, blocking: false }))]
}
