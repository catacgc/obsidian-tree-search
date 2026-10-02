export type AttachmentKind = "image" | "audio" | "video" | "file"
export type SessionAttachment = { name: string; ext: string }
export type AttachmentPlan = {
  renames: { from: string; to: string }[]
  trash: string[]
  buffers: Record<string, string> // input buffers with embeds rewritten
  error?: { ambiguous: string } | { invalidName: string }
}

/** Buffer key for the outline; a colon can't appear in an Obsidian note name. */
export const OUTLINE_KEY = ":outline"
export const INVALID_NAME_RE = /[\\/:*?"<>|]/

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "text/plain": "txt",
}

/** Latin letters that NFKD does not decompose into base + mark. */
const FOLD: Record<string, string> = { ø: "o", æ: "ae", œ: "oe", ß: "ss", đ: "d", ð: "d", ł: "l", þ: "th", ı: "i" }

export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[øæœßđðłþı]/g, c => FOLD[c])
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "attachment"
}

export function attachmentKind(mime: string): AttachmentKind {
  const top = mime.split("/")[0]?.toLowerCase()
  return top === "image" || top === "audio" || top === "video" ? top : "file"
}

function extOf(name: string): string | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(name)
  return m ? m[1].toLowerCase() : null
}

export function attachmentExt(fileName: string, mime: string): string {
  const fromName = extOf(fileName)
  if (fromName) return fromName
  const lower = mime.toLowerCase()
  const mapped = EXT_BY_MIME[lower]
  if (mapped) return mapped
  const sub = lower.split("/")[1] ?? ""
  return /^[a-z0-9]+$/.test(sub) ? sub : "bin"
}

/** `${slug}-${kind}-${N}.${ext}` with the smallest N ≥ 1 not taken. */
export function attachmentName(base: string, kind: AttachmentKind, ext: string, taken: (name: string) => boolean): string {
  const stem = `${slugify(base)}-${kind}-`
  for (let n = 1; ; n++) {
    const name = `${stem}${n}.${ext}`
    if (!taken(name)) return name
  }
}

type Embed = { key: string; index: number; length: number; target: string; alias: string | undefined }

const EMBED_RE = /!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g

function withSuffix(name: string, n: number): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`
}

/**
 * Match `![[…]]` embeds in the buffers to session attachments, choose each matched attachment's
 * final name (from the alias or the typed target), rewrite the embeds, and trash unmatched ones.
 */
export function resolveAttachmentEmbeds(
  buffers: Record<string, string>,
  session: SessionAttachment[],
  exists: (name: string) => boolean,
): AttachmentPlan {
  const embeds: Embed[] = []
  for (const key of Object.keys(buffers)) {
    for (const m of buffers[key].matchAll(EMBED_RE)) {
      embeds.push({ key, index: m.index!, length: m[0].length, target: m[1].trim(), alias: m[2] })
    }
  }

  // Pass A: exact (case-insensitive) name match.
  const match = new Map<Embed, number>()
  const matchedA = new Set<number>()
  for (const e of embeds) {
    const i = session.findIndex(a => a.name.toLowerCase() === e.target.toLowerCase())
    if (i >= 0) {
      match.set(e, i)
      matchedA.add(i)
    }
  }

  // Pass B: unresolved targets match the single remaining attachment with the same extension.
  const remaining = session.map((_, i) => i).filter(i => !matchedA.has(i))
  for (const e of embeds) {
    if (match.has(e) || exists(e.target)) continue
    const ext = extOf(e.target)
    const candidates = ext === null ? remaining : remaining.filter(i => session[i].ext.toLowerCase() === ext)
    if (candidates.length > 1) return { renames: [], trash: [], buffers, error: { ambiguous: e.target } }
    if (candidates.length === 1) match.set(e, candidates[0])
  }

  // Desired names, decided by each attachment's first matching embed.
  const finalNames = session.map(a => a.name)
  const decided = new Set<number>()
  for (const e of embeds) {
    const i = match.get(e)
    if (i === undefined || decided.has(i)) continue
    decided.add(i)
    const att = session[i]
    const alias = e.alias?.trim()
    const desired = alias
      ? `${slugify(alias)}.${att.ext}`
      : extOf(e.target) === null ? `${e.target}.${att.ext}` : e.target
    if (INVALID_NAME_RE.test(desired)) return { renames: [], trash: [], buffers, error: { invalidName: desired } }
    if (desired === att.name) continue
    const clashes = (name: string) => {
      const lower = name.toLowerCase()
      return exists(name) || finalNames.some((n, j) => j !== i && n.toLowerCase() === lower)
    }
    let final = desired
    for (let n = 2; clashes(final); n++) final = withSuffix(desired, n)
    finalNames[i] = final
  }

  // Rewrite embeds whose target differs from the final name (back to front per buffer).
  const out: Record<string, string> = { ...buffers }
  for (let k = embeds.length - 1; k >= 0; k--) {
    const e = embeds[k]
    const i = match.get(e)
    if (i === undefined || e.target === finalNames[i]) continue
    const text = out[e.key]
    const replacement = e.alias === undefined ? `![[${finalNames[i]}]]` : `![[${finalNames[i]}|${e.alias}]]`
    out[e.key] = text.slice(0, e.index) + replacement + text.slice(e.index + e.length)
  }

  const matched = new Set(match.values())
  return {
    renames: session.flatMap((a, i) => (finalNames[i] !== a.name ? [{ from: a.name, to: finalNames[i] }] : [])),
    trash: session.filter((_, i) => !matched.has(i)).map(a => a.name),
    buffers: out,
  }
}
