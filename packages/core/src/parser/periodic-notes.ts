// Resolves the semantic date of a daily/weekly/monthly (periodic) note from its
// path, using the vault's Obsidian moment format (e.g.
// "[Weekly]/YYYY/MM/gggg-MMM-[W]ww"). Core stays free of any date library: each
// runtime injects a `moment`-compatible strict parser (the Obsidian plugin uses
// the `moment` bundled with Obsidian; the CLI uses the `moment` npm package).
//
// Weekly notes need special care: moment lets month tokens (MM/MMM) override the
// week tokens (ww/gggg) during parsing, collapsing e.g. "…W31" to the 1st of the
// month. So when the format carries a week token we pull the week-year and week
// out of the path ourselves (pure regex) and reparse them as "gggg-[W]ww", which
// moment resolves to the correct week start.

export type PeriodicNoteConfig = {
  /** Vault-relative folder the format is rooted in (may be "" for vault root). */
  folder: string
  /** Obsidian/moment format string, e.g. "[Weekly]/YYYY/MM/gggg-MMM-[W]ww". */
  format: string
}

/** Strict parse of `input` against a moment `format`; ms epoch or null. */
export type MomentParse = (input: string, format: string) => number | null

function stripExt(path: string): string {
  return path.replace(/\.md$/i, "")
}

function stripFolder(path: string, folder: string): string | null {
  if (!folder) return path
  const prefix = folder.replace(/\/+$/, "") + "/"
  return path.startsWith(prefix) ? path.slice(prefix.length) : null
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

type WeekRegex = { re: RegExp; weekIdx: number; weekYearIdx: number; yearIdx: number }

// Compile a moment date-format into an anchored regex that captures the week-year
// and week fields (and a plain year as weekYear fallback). Returns null when the
// format has no week token, so callers know to keep moment's own parse.
function buildWeekRegex(format: string): WeekRegex | null {
  let src = "^"
  let group = 0
  let weekIdx = -1
  let weekYearIdx = -1
  let yearIdx = -1
  let i = 0

  while (i < format.length) {
    const ch = format[i]
    if (ch === "[") {
      const end = format.indexOf("]", i)
      const literal = end === -1 ? format.slice(i + 1) : format.slice(i + 1, end)
      src += escapeRegex(literal)
      i = end === -1 ? format.length : end + 1
      continue
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i
      while (j < format.length && format[j] === ch) j++
      const len = j - i
      switch (ch) {
        case "w": case "W": src += "(\\d{1,2})"; weekIdx = ++group; break
        case "g": case "G": src += "(\\d{2,4})"; weekYearIdx = ++group; break
        case "Y": src += "(\\d{2,4})"; yearIdx = ++group; break
        case "M": src += len >= 3 ? "[^/\\-\\s.]+" : "\\d{1,2}"; break
        case "D": src += "\\d{1,3}"; break
        case "d": src += len >= 3 ? "[^/\\-\\s.]+" : "\\d{1,2}"; break
        case "e": case "E": case "Q": src += "\\d{1,2}"; break
        // Unknown/time letters don't appear in note-path formats; treat literally.
        default: src += escapeRegex(ch.repeat(len))
      }
      i = j
      continue
    }
    src += escapeRegex(ch)
    i++
  }
  src += "$"

  if (weekIdx === -1) return null
  return { re: new RegExp(src), weekIdx, weekYearIdx, yearIdx }
}

function extractWeek(built: WeekRegex, input: string): { weekYear: string; week: string } | null {
  const m = built.re.exec(input)
  if (!m) return null
  const week = m[built.weekIdx]
  const weekYear = built.weekYearIdx !== -1 ? m[built.weekYearIdx]
    : built.yearIdx !== -1 ? m[built.yearIdx]
    : undefined
  if (!week || !weekYear) return null
  return { weekYear, week }
}

/**
 * Build a resolver mapping a vault-relative `.md` path to the note's date
 * (ms epoch) when it matches one of the periodic-note formats, else null.
 * Configs are tried in order; the first match wins.
 */
export function makePeriodicDateResolver(
  configs: PeriodicNoteConfig[],
  momentParse: MomentParse,
): (path: string) => number | null {
  const compiled = configs
    .filter(c => c.format && c.format.trim().length > 0)
    .map(c => ({ ...c, week: buildWeekRegex(c.format) }))
  if (compiled.length === 0) return () => null

  return (path: string) => {
    const withoutExt = stripExt(path)
    for (const config of compiled) {
      const rel = stripFolder(withoutExt, config.folder)
      if (rel === null) continue

      // Strict full parse validates the path really is a periodic note (correct
      // month names, week numbers, etc.) and is the fallback date.
      const full = momentParse(rel, config.format)
      if (full === null) continue

      // Week-bearing format: prefer the true week start over the month collapse.
      if (config.week) {
        const wk = extractWeek(config.week, rel)
        if (wk) {
          const wyFmt = wk.weekYear.length === 4 ? "gggg" : "gg"
          const wFmt = wk.week.length >= 2 ? "ww" : "w"
          const weekMs = momentParse(`${wk.weekYear}-W${wk.week}`, `${wyFmt}-[W]${wFmt}`)
          if (weekMs !== null) return weekMs
        }
      }
      return full
    }
    return null
  }
}
