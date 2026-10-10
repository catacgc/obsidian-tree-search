import { describe, it, expect } from "bun:test"
import { formatRelativeDate } from "../search/relative-date.ts"
import { UNDATED_AGE } from "../graph/boost.ts"

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

  it("shows a future date verbatim instead of Today", () => {
    expect(formatRelativeDate(0, "2026-10-09", TODAY)).toEqual({ label: "2026-10-09", absolute: "2026-10-09" })
  })
})
