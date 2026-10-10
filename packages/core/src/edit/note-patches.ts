import { INVALID_NAME_RE } from "./attachments.ts"
import { appendContent, type OutlineLine } from "./outline-edit.ts"

// Link-bullet patches: an Append outline bullet that is only a wikilink, optionally
// with `(key:: value)` fields, is also a patch on the linked note. Save creates the
// note when missing, adds the link's alias and heading, and appends each field to
// the note's frontmatter. Pure: the plugin applies the patches (`applyNotePatch`).

export type LinkField = { key: string; value: string }
/** A bullet whose text is one wikilink, optionally followed by `(key:: value)` fields. */
export type LinkBullet = { name: string; header: string | null; alias: string | null; fields: LinkField[] }
/** Everything Save writes into one note, merged across the outline (name matched case-insensitively, first spelling kept). */
export type NotePatch = { name: string; aliases: string[]; headings: string[]; fields: LinkField[] }

const LINK_BULLET_RE = /^\[\[([^\[\]]+)\]\]((?:\s*\([^()]*\))*)$/
const FIELD_GROUP_RE = /\([^()]*\)/g
const FIELD_RE = /^\(\s*([A-Za-z][\w -]*?)\s*::\s*(.*?)\s*\)$/
const HEADING_LINE_RE = /^#{1,6}\s+(.+?)\s*#*\s*$/

/** The link bullet `text` is, or null when it has other text, an invalid name, a block ref, or a reserved `meta-` field. */
export function parseLinkBullet(text: string): LinkBullet | null {
  const m = text.trim().match(LINK_BULLET_RE)
  if (!m) return null
  const inner = m[1]
  const bar = inner.indexOf("|")
  const target = bar < 0 ? inner : inner.slice(0, bar)
  const alias = bar < 0 ? "" : inner.slice(bar + 1).trim()
  const hash = target.indexOf("#")
  const name = (hash < 0 ? target : target.slice(0, hash)).trim()
  const header = hash < 0 ? "" : target.slice(hash + 1).trim()
  if (name === "" || INVALID_NAME_RE.test(name) || header.startsWith("^")) return null
  const fields: LinkField[] = []
  for (const g of m[2].matchAll(FIELD_GROUP_RE)) {
    const f = g[0].match(FIELD_RE)
    if (!f || f[2] === "" || f[1].toLowerCase().startsWith("meta-")) return null
    fields.push({ key: f[1], value: f[2] })
  }
  return { name, header: header || null, alias: alias || null, fields }
}

export function renderLinkBullet(b: LinkBullet): string {
  const link = `[[${b.name}${b.header ? "#" + b.header : ""}${b.alias ? "|" + b.alias : ""}]]`
  return link + b.fields.map(f => ` (${f.key}:: ${f.value})`).join("")
}

function pushUnique(list: string[], value: string): void {
  const lower = value.toLowerCase()
  if (!list.some(v => v.toLowerCase() === lower)) list.push(value)
}

/**
 * The note patches of an outline, and the outline to write: link bullets lose their fields
 * (they go to frontmatter). With `dropPatchOnlyRoots`, a childless root link bullet that carries
 * an alias, heading or field is only a patch and is removed from the written outline.
 */
export function planOutlinePatches(lines: OutlineLine[], opts: { dropPatchOnlyRoots: boolean }): { lines: OutlineLine[]; patches: NotePatch[] } {
  const patches: NotePatch[] = []
  const byName = new Map<string, NotePatch>()
  const out: OutlineLine[] = []
  lines.forEach((line, i) => {
    const b = line.marker === "- " ? parseLinkBullet(line.text) : null
    if (!b) {
      out.push(line)
      return
    }
    const lower = b.name.toLowerCase()
    let patch = byName.get(lower)
    if (!patch) {
      patch = { name: b.name, aliases: [], headings: [], fields: [] }
      byName.set(lower, patch)
      patches.push(patch)
    }
    if (b.alias && b.alias.toLowerCase() !== lower) pushUnique(patch.aliases, b.alias)
    if (b.header) pushUnique(patch.headings, b.header)
    for (const f of b.fields) {
      if (f.key.toLowerCase() === "aliases") {
        pushUnique(patch.aliases, f.value)
        continue
      }
      const key = f.key.toLowerCase()
      const value = f.value.toLowerCase()
      if (!patch.fields.some(p => p.key.toLowerCase() === key && p.value.toLowerCase() === value)) patch.fields.push(f)
    }
    const next = lines[i + 1]
    const patchOnly =
      opts.dropPatchOnlyRoots && line.depth === 0 && (next === undefined || next.depth === 0) && (b.alias !== null || b.header !== null || b.fields.length > 0)
    if (!patchOnly) out.push({ ...line, text: renderLinkBullet({ ...b, fields: [] }) })
  })
  return { lines: out, patches }
}

/** `content` with a `## heading` appended at the end, unless a heading with that text (any level, case-insensitive) exists. */
export function ensureHeading(content: string, heading: string): string {
  const want = heading.trim().toLowerCase()
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(HEADING_LINE_RE)
    if (m && m[1].toLowerCase() === want) return content
  }
  return appendContent(content, "## " + heading)
}

/** The editor hints for one patch. */
export function describePatch(p: NotePatch, exists: boolean): string[] {
  return [
    ...(exists ? [] : [`Creates note "${p.name}"`]),
    ...p.aliases.map(a => `Adds alias "${a}" to ${p.name}`),
    ...p.headings.map(h => `Adds heading "${h}" to ${p.name}`),
    ...p.fields.map(f => `Sets ${f.key}: ${f.value} on ${p.name}`),
  ]
}
