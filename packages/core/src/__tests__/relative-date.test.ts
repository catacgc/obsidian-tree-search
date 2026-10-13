import { describe, it, expect } from "bun:test"
import { formatRelativeDate, rowDate } from "../search/relative-date.ts"
import { UNDATED_AGE } from "../graph/boost.ts"
import type { ParsedNode } from "../graph/types.ts"

const TODAY = new Date(2026, 9, 5, 15, 30) // 2026-10-05, local time
const label = (ageDays: number, sourceDate: string | null = null) => formatRelativeDate(ageDays, sourceDate, TODAY)?.label

describe("formatRelativeDate", () => {
  it("is null for undated rows", () => {
    expect(formatRelativeDate(UNDATED_AGE, null, TODAY)).toBeNull()
  })

  it("days up to a week: Today, then 1d..7d", () => {
    expect([0, 1, 2, 7].map(d => label(d))).toEqual(["Today", "1d", "2d", "7d"])
  })

  it("weeks after 7 days, up to 3w", () => {
    expect([8, 13, 14, 21, 27].map(d => label(d))).toEqual(["1w", "1w", "2w", "3w", "3w"])
  })

  it("whole calendar months from 4 weeks to 12 months", () => {
    expect(label(28, "2026-09-07")).toBe("1m") // 28 days, not yet a calendar month
    expect(label(30, "2026-09-05")).toBe("1m")
    expect(label(61, "2026-08-05")).toBe("2m")
    expect(label(60, "2026-08-06")).toBe("1m")
    expect(label(365, "2025-10-05")).toBe("12m")
    expect(label(394, "2025-09-06")).toBe("12m")
  })

  it("the year once older than 12 months", () => {
    expect(label(395, "2025-09-05")).toBe("2025")
    expect(label(700, "2024-11-05")).toBe("2024")
  })

  it("keeps the absolute date for the hover tooltip, rebuilding it from ageDays when the line has none", () => {
    expect(formatRelativeDate(3, null, TODAY)).toEqual({ label: "3d", absolute: "2026-10-02" })
    expect(formatRelativeDate(400, "2025-08-31", TODAY)).toEqual({ label: "2025", absolute: "2025-08-31" })
  })

  describe("future dates", () => {
    // TODAY is Monday 2026-10-05; next calendar week runs Mon 10-12 .. Sun 10-18.
    const ahead = (date: string, today = TODAY) => formatRelativeDate(-1, date, today)?.label

    it("Tomorrow, then weekday names up to 6 days ahead", () => {
      expect(ahead("2026-10-06")).toBe("Tomorrow")
      expect(["2026-10-07", "2026-10-09", "2026-10-11"].map(d => ahead(d))).toEqual(["Wed", "Fri", "Sun"])
    })

    it("Next Week for the rest of the next calendar week (Monday start)", () => {
      expect(["2026-10-12", "2026-10-18"].map(d => ahead(d))).toEqual(["Next Week", "Next Week"])
      const saturday = new Date(2026, 9, 10, 9)
      expect(["2026-10-12", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"].map(d => ahead(d, saturday)))
        .toEqual(["Mon", "Fri", "Next Week", "Next Week", "This Month"])
    })

    it("This Month, then the month's name within the year, then the year", () => {
      expect(["2026-10-19", "2026-10-31"].map(d => ahead(d))).toEqual(["This Month", "This Month"])
      expect(["2026-11-01", "2026-12-31"].map(d => ahead(d))).toEqual(["Nov", "Dec"])
      expect(["2027-01-01", "2028-03-01"].map(d => ahead(d))).toEqual(["2027", "2028"])
    })

    it("Next Week across a year boundary, then the year", () => {
      const wednesday = new Date(2026, 11, 30, 9) // next week: Mon 2027-01-04 .. Sun 01-10
      expect(["2027-01-05", "2027-01-06", "2027-01-10", "2027-01-11"].map(d => ahead(d, wednesday)))
        .toEqual(["Tue", "Next Week", "Next Week", "2027"])
    })

    it("rebuilds a future date from a negative ageDays when the row has no date of its own", () => {
      expect(formatRelativeDate(-1, null, TODAY)).toEqual({ label: "Tomorrow", absolute: "2026-10-06" })
      expect(formatRelativeDate(-30, null, TODAY)).toEqual({ label: "Nov", absolute: "2026-11-04" })
    })
  })
})

describe("rowDate", () => {
  const line = (searchKey: string, isTask: boolean, extra: { isCompleted?: boolean; inheritedDate?: string } = {}) =>
    ({ nodeType: "text", searchKey, isTask, isCompleted: false, ...extra }) as ParsedNode
  const shown = (node: ParsedNode, ageDays = 3) => rowDate(node, ageDays, TODAY)?.label ?? null

  it("shows no date on a task without a scheduled or due date: neither its created stamp nor its note's date", () => {
    expect(shown(line("call Bob [created:: 2026-10-02]", true))).toBeNull()
    expect(shown(line("call Bob", true))).toBeNull()
    expect(shown(line("call Bob [created:: 2026-10-02]", true, { isCompleted: true }))).toBeNull()
  })

  it("shows a task's scheduled or due date, its own or one inherited from an open subtask", () => {
    expect(shown(line("call Bob [created:: 2026-10-01] [scheduled:: 2026-10-06]", true), -1)).toBe("Tomorrow")
    expect(shown(line("call Bob 📅 2026-10-02", true))).toBe("3d")
    expect(shown(line("plan launch", true, { inheritedDate: "2026-10-06" }), -1)).toBe("Tomorrow")
  })

  it("keeps the date of a line that is not a task", () => {
    expect(shown(line("met Bob [created:: 2026-10-02]", false))).toBe("3d")
    expect(shown({ nodeType: "page", searchKey: "Bob" } as ParsedNode)).toBe("3d")
  })
})
