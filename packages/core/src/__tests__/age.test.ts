import { describe, it, expect } from "bun:test"
import { getAgeDays, ageDaysFromText, isUndated, calculateBoost, UNDATED_AGE } from "../graph/boost.ts"
import { extractPageDate } from "../parser/frontmatter.ts"
import { makePeriodicDateResolver, type MomentParse } from "../parser/periodic-notes.ts"

const DAY = 24 * 60 * 60 * 1000

describe("getAgeDays precedence", () => {
  it("returns UNDATED_AGE when no date is present", () => {
    expect(getAgeDays()).toBe(UNDATED_AGE)
    expect(getAgeDays("just some text, no date")).toBe(UNDATED_AGE)
    expect(isUndated(getAgeDays())).toBe(true)
  })

  it("uses a YYYY-MM-DD embedded in the text/filename", () => {
    const age = getAgeDays("meeting 2020-01-01 notes")
    expect(age).toBeGreaterThan(1000)
    expect(isUndated(age)).toBe(false)
  })

  it("prefers a text date over an explicit page date", () => {
    // Text says 2020 (old); explicit date is now (fresh) — text wins.
    const age = getAgeDays("logged 2020-01-01", Date.now())
    expect(age).toBeGreaterThan(1000)
  })

  it("falls back to the explicit page date when the text has none", () => {
    const tenDaysAgo = Date.now() - 10 * DAY
    expect(getAgeDays("no date here", tenDaysAgo)).toBe(10)
  })

  it("null/undefined explicit date does not count as a date", () => {
    expect(getAgeDays(undefined, null)).toBe(UNDATED_AGE)
  })
})

describe("ageDaysFromText", () => {
  it("returns null when no date is present, days otherwise", () => {
    expect(ageDaysFromText("nothing")).toBeNull()
    expect(ageDaysFromText(undefined)).toBeNull()
    expect(ageDaysFromText("2020-01-01")).toBeGreaterThan(1000)
  })
})

describe("calculateBoost age clamp", () => {
  it("gives undated nodes a zero age contribution without swamping the type boost", () => {
    const dated = calculateBoost("text", "x", 0)
    const undated = calculateBoost("text", "x", UNDATED_AGE)
    // Undated age contributes 0; a fresh dated node contributes 1000 more.
    expect(dated - undated).toBe(1000)
    // Type dominance survives: an undated page still outranks a fresh text node.
    expect(calculateBoost("page", "x", UNDATED_AGE)).toBeGreaterThan(calculateBoost("text", "x", 0))
  })

  it("does not underflow for very old dated nodes", () => {
    expect(calculateBoost("text", "x", 99999)).toBe(calculateBoost("text", "x", 1000))
  })
})

describe("extractPageDate", () => {
  it("prefers updated over created", () => {
    const updated = new Date("2024-05-01").getTime()
    const created = new Date("2020-01-01").getTime()
    expect(extractPageDate({ updated: "2024-05-01", created: "2020-01-01" })).toBe(updated)
    expect(extractPageDate({ created: "2020-01-01" })).toBe(created)
  })

  it("accepts js-yaml Date objects and rejects garbage", () => {
    const d = new Date("2024-05-01")
    expect(extractPageDate({ updated: d })).toBe(d.getTime())
    expect(extractPageDate({ updated: "not a date" })).toBeNull()
    expect(extractPageDate({})).toBeNull()
  })
})

describe("makePeriodicDateResolver", () => {
  const FMT = "[Weekly]/YYYY/MM/gggg-MMM-[W]ww"
  const MONTH_MS = new Date("2026-07-01").getTime() // moment's month-collapse
  const WEEK_MS = new Date("2026-07-26").getTime()  // true week start for W31
  // Fake moment parser: full format validates to month-start (as real moment
  // does); the week-only reparse yields the true week start.
  const fakeParse: MomentParse = (input, format) => {
    if (format === FMT && input === "Weekly/2026/07/2026-Jul-W31") return MONTH_MS
    if (format === "gggg-[W]ww" && input === "2026-W31") return WEEK_MS
    return null
  }

  it("prefers the parsed week start over moment's month collapse", () => {
    const resolve = makePeriodicDateResolver([{ folder: "Inbox", format: FMT }], fakeParse)
    // Not the month-start fallback — the week-derived date.
    expect(resolve("Inbox/Weekly/2026/07/2026-Jul-W31.md")).toBe(WEEK_MS)
  })

  it("falls back to the full parse when the week reparse fails", () => {
    const onlyFull: MomentParse = (input, format) =>
      format === FMT && input === "Weekly/2026/07/2026-Jul-W31" ? MONTH_MS : null
    const resolve = makePeriodicDateResolver([{ folder: "Inbox", format: FMT }], onlyFull)
    expect(resolve("Inbox/Weekly/2026/07/2026-Jul-W31.md")).toBe(MONTH_MS)
  })

  it("returns null for paths outside the folder or that fail strict validation", () => {
    const resolve = makePeriodicDateResolver([{ folder: "Inbox", format: FMT }], fakeParse)
    expect(resolve("Other/Weekly/2026/07/2026-Jul-W31.md")).toBeNull()
    expect(resolve("Inbox/random-note.md")).toBeNull()
  })

  it("supports a vault-root folder (empty string)", () => {
    const resolve = makePeriodicDateResolver([{ folder: "", format: FMT }], fakeParse)
    expect(resolve("Weekly/2026/07/2026-Jul-W31.md")).toBe(WEEK_MS)
  })

  it("uses moment's own date for non-week formats (e.g. daily notes)", () => {
    const day = new Date("2026-07-15").getTime()
    const dailyParse: MomentParse = (input, format) =>
      format === "YYYY-MM-DD" && input === "2026-07-15" ? day : null
    const resolve = makePeriodicDateResolver([{ folder: "Daily", format: "YYYY-MM-DD" }], dailyParse)
    expect(resolve("Daily/2026-07-15.md")).toBe(day)
  })

  it("returns a no-op resolver when there are no valid configs", () => {
    const resolve = makePeriodicDateResolver([{ folder: "x", format: "" }], fakeParse)
    expect(resolve("anything.md")).toBeNull()
  })
})
