// The archive tag (`IndexSettings.archiveTag`, written `#archive`) in a line or heading: a whole tag preceded by
// whitespace or the start of the text, case-insensitive. `#archived`, `#archive-old`, `#archive/x` and
// `[[Note#archive]]` don't count.

const LEGACY_ARCHIVE = /\(meta-mdtree::\s*archive\s*\)/
const LEGACY_ARCHIVE_ALL = /\s*\(meta-mdtree::\s*archive\s*\)/g

function tagRe(tag: string, flags: string): RegExp {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|\\s)#${escaped}(?![\\w/-])`, flags)
}

/** Whether `text` carries the archive tag `#<tag>`. */
export function hasArchiveTag(text: string, tag: string): boolean {
  return tagRe(tag, "i").test(text)
}

/** `line` with ` #<tag>` appended (trailing whitespace dropped); unchanged when it already has the tag. */
export function addArchiveTag(line: string, tag: string): string {
  return hasArchiveTag(line, tag) ? line : `${line.trimEnd()} #${tag}`
}

/** `line` without any `#<tag>`, each taken with the whitespace before it; trailing whitespace dropped. Meant for list
 *  and heading lines, where a marker always precedes the tag. */
export function removeArchiveTag(line: string, tag: string): string {
  return line.replace(tagRe(tag, "gi"), "").trimEnd()
}

/** Rewrites every legacy `(meta-mdtree:: archive)` marker to the archive tag: the markers are removed and the tag
 *  appended to their line once (not when the line already has it). Line endings are kept. `lines`: lines changed. */
export function convertLegacyArchive(content: string, tag: string): { content: string; lines: number } {
  let lines = 0
  const converted = content.replace(/[^\r\n]+/g, line => {
    if (!LEGACY_ARCHIVE.test(line)) return line
    lines++
    return addArchiveTag(line.replace(LEGACY_ARCHIVE_ALL, ""), tag)
  })
  return { content: converted, lines }
}
