// ── Marker-bounded section upsert ───────────────────────────────────────────────
//
// Every note "Pull and organise notes" writes into gets two fixed, hidden-
// marker-bounded regions at its top (after frontmatter if present): a flat
// list of bare topic links, and a flat list of text mentions referencing
// that note. Re-running the organise action must update these regions
// in place rather than duplicating them - that idempotency is this module's
// entire job. Nothing here touches the filesystem; the caller (obsidian-
// utils.ts, which owns `app.vault`) reads/writes the file and passes plain
// strings through.

type SectionMarker = "children" | "mentions"

function markerTags(marker: SectionMarker): { open: string; close: string } {
  return { open: `<!-- organise:${marker} -->`, close: `<!-- /organise:${marker} -->` }
}

/**
 * Splits on any line ending and reports which one the note actually uses, so
 * a CRLF note's frontmatter delimiter (`"---\r"` after a naive `split("\n")`)
 * still compares equal to the plain `"---"` this module matches against -
 * mismatching that check made `frontmatterEnd` blind to CRLF frontmatter,
 * inserting the fresh section block at line 0, ahead of (and breaking) it.
 */
function splitLines(content: string): { lines: string[]; eol: string } {
  return { lines: content.split(/\r\n|\r|\n/), eol: content.includes("\r\n") ? "\r\n" : "\n" }
}

/** End of a leading `---\n...\n---` frontmatter block, or 0 if there is none. */
function frontmatterEnd(lines: string[]): number {
  if (lines[0] !== "---") return 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") return i + 1
  }
  return 0
}

/**
 * Replaces one marker pair's body in place, deduping `newLines` against
 * whatever the section already contains (exact line match). Returns `null`
 * if the marker pair isn't found (caller falls back to creating it).
 */
function replaceSectionBody(lines: string[], marker: SectionMarker, newLines: string[]): string[] | null {
  const { open, close } = markerTags(marker)
  const openIdx = lines.indexOf(open)
  if (openIdx === -1) return null
  const closeIdx = lines.indexOf(close, openIdx + 1)
  if (closeIdx === -1) return null

  const existing = lines.slice(openIdx + 1, closeIdx)
  const merged = [...existing]
  for (const line of newLines) {
    if (!merged.includes(line)) merged.push(line)
  }
  return [...lines.slice(0, openIdx + 1), ...merged, ...lines.slice(closeIdx)]
}

/**
 * Upserts both managed sections (children, then mentions, in that fixed
 * order) into a note's content. `childrenLines`/`mentionsLines` are already
 * fully rendered bullet lines (e.g. `"- [[Child]]"`). If both marker pairs
 * already exist, each is updated independently and in place. If either is
 * missing (first run, or a manually-stripped marker), both are (re)created
 * together as one fresh block right after frontmatter - this deliberately
 * does not try to preserve a partially-existing lone section's content in
 * that rare case; see the design doc's noted risk on hand-edited regions.
 */
export function upsertOrganiseSections(content: string, childrenLines: string[], mentionsLines: string[]): string {
  const { lines: original, eol } = splitLines(content)

  const childrenReplaced = replaceSectionBody(original, "children", childrenLines)
  const mentionsReplaced = replaceSectionBody(original, "mentions", mentionsLines)

  if (childrenReplaced && mentionsReplaced) {
    return replaceSectionBody(childrenReplaced, "mentions", mentionsLines)!.join(eol)
  }

  const insertAt = frontmatterEnd(original)
  const { open: childrenOpen, close: childrenClose } = markerTags("children")
  const { open: mentionsOpen, close: mentionsClose } = markerTags("mentions")
  const block = [
    childrenOpen, ...childrenLines, childrenClose, "",
    mentionsOpen, ...mentionsLines, mentionsClose, "",
  ]
  return [...original.slice(0, insertAt), ...block, ...original.slice(insertAt)].join(eol)
}
