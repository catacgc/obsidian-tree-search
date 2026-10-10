import { describe, it, expect } from "bun:test"
import { setTaskDone, scheduleTask, rescheduleDate, scheduleUnscheduledTasks, applyTaskEdit } from "../edit/task-edit.ts"
import { StaleLineError } from "../edit/outline-edit.ts"

const TODAY = "2026-10-06"

describe("setTaskDone", () => {
  it("completes an open task with today's completion date, keeping indent and marker", () => {
    expect(setTaskDone("    - [ ] call Bob", true, TODAY)).toBe("    - [x] call Bob [completion:: 2026-10-06]")
    expect(setTaskDone("* [ ] call Bob  ", true, TODAY)).toBe("* [x] call Bob [completion:: 2026-10-06]")
    expect(setTaskDone("1. [ ] call Bob", true, TODAY)).toBe("1. [x] call Bob [completion:: 2026-10-06]")
  })

  it("replaces an existing completion date instead of adding a second", () => {
    expect(setTaskDone("- [ ] x [completion:: 2026-01-01] y", true, TODAY)).toBe("- [x] x [completion:: 2026-10-06] y")
  })

  it("puts the completion date before a trailing block id", () => {
    expect(setTaskDone("- [ ] call Bob ^abc-1", true, TODAY)).toBe("- [x] call Bob [completion:: 2026-10-06] ^abc-1")
  })

  it("reopens a done task and drops its completion date", () => {
    expect(setTaskDone("\t- [x] call Bob [completion:: 2026-10-01]", false, TODAY)).toBe("\t- [ ] call Bob")
    expect(setTaskDone("- [X] a [completion:: 2026-10-01] b", false, TODAY)).toBe("- [ ] a b")
    expect(setTaskDone("- [x] call Bob", false, TODAY)).toBe("- [ ] call Bob")
  })

  it("is null for a line that is not a task", () => {
    expect(setTaskDone("- call Bob", true, TODAY)).toBeNull()
    expect(setTaskDone("call [ ] Bob", true, TODAY)).toBeNull()
    expect(setTaskDone("## [ ] heading", true, TODAY)).toBeNull()
  })
})

describe("scheduleTask", () => {
  it("appends a scheduled date to an open task", () => {
    expect(scheduleTask("- [ ] call Bob ", "2026-10-07")).toBe("- [ ] call Bob [scheduled:: 2026-10-07]")
    expect(scheduleTask("- [ ] call Bob ^abc", "2026-10-07")).toBe("- [ ] call Bob [scheduled:: 2026-10-07] ^abc")
  })

  it("replaces the date of an existing scheduled field in place, in any form", () => {
    expect(scheduleTask("- [ ] a [scheduled:: 2026-10-01] b", "2026-10-12")).toBe("- [ ] a [scheduled:: 2026-10-12] b")
    expect(scheduleTask("- [ ] a (scheduled:: 2026-10-01)", "2026-10-12")).toBe("- [ ] a (scheduled:: 2026-10-12)")
    expect(scheduleTask("- [ ] a ⏳ 2026-10-01 b", "2026-10-12")).toBe("- [ ] a ⏳ 2026-10-12 b")
  })

  it("is null for a done task or a non-task line", () => {
    expect(scheduleTask("- [x] call Bob", "2026-10-07")).toBeNull()
    expect(scheduleTask("- call Bob", "2026-10-07")).toBeNull()
  })
})

describe("rescheduleDate", () => {
  // 2026-10-05 is a Monday.
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  const on = (i: number) => new Date(2026, 9, 5 + i, 23, 30)

  it("Today is the local calendar day, even late in the evening", () => {
    expect(rescheduleDate("today", on(0))).toBe("2026-10-05")
  })

  it("Tomorrow is the next calendar day, across month ends", () => {
    expect(rescheduleDate("tomorrow", on(0))).toBe("2026-10-06")
    expect(rescheduleDate("tomorrow", new Date(2026, 11, 31, 9))).toBe("2027-01-01")
  })

  it("Weekend is the next Saturday after today", () => {
    expect(days.map((_, i) => rescheduleDate("weekend", on(i)))).toEqual([
      "2026-10-10", "2026-10-10", "2026-10-10", "2026-10-10", "2026-10-10", "2026-10-17", "2026-10-17",
    ])
  })

  it("Next Week is the next Monday after today", () => {
    expect(days.map((_, i) => rescheduleDate("nextWeek", on(i)))).toEqual([
      "2026-10-12", "2026-10-12", "2026-10-12", "2026-10-12", "2026-10-12", "2026-10-12", "2026-10-12",
    ])
  })
})

describe("scheduleUnscheduledTasks", () => {
  const DAY = "2026-10-07"

  it("schedules only open, non-empty, unscheduled tasks under a link root", () => {
    const input = "- [[P]]\n    - [ ] call ^id\n    - [ ] a ⏳ 2026-10-01\n    - [x] done\n    - note\n    - [ ] "
    const out = scheduleUnscheduledTasks(input, DAY).split("\n")
    const lines = input.split("\n")
    expect(out).toEqual([...lines.slice(0, 1), "    - [ ] call [scheduled:: 2026-10-07] ^id", ...lines.slice(2)])
  })

  it("leaves tasks nested under a text line unscheduled", () => {
    expect(scheduleUnscheduledTasks("- [ ] parent\n    - [ ] child", DAY)).toBe("- [ ] parent [scheduled:: 2026-10-07]\n    - [ ] child")
  })
})

describe("applyTaskEdit", () => {
  const DAY = "2026-10-07"
  const C = "- [[P]]\n   - [ ] parent\n      - [ ] a\n      - [x] b [completion:: 2026-10-01]\n      - note\n         - [ ] deep\n   - [ ] sibling\n"

  it("completing a task completes its open nested tasks only", () => {
    expect(applyTaskEdit(C, 1, "   - [ ] parent", { kind: "done", done: true, today: DAY })).toBe(
      "- [[P]]\n   - [x] parent [completion:: 2026-10-07]\n      - [x] a [completion:: 2026-10-07]\n" +
      "      - [x] b [completion:: 2026-10-01]\n      - note\n         - [x] deep [completion:: 2026-10-07]\n   - [ ] sibling\n",
    )
  })

  it("scheduling and reopening touch only the head line", () => {
    expect(applyTaskEdit(C, 1, "   - [ ] parent", { kind: "schedule", date: DAY })).toBe(
      C.replace("   - [ ] parent\n", "   - [ ] parent [scheduled:: 2026-10-07]\n"),
    )
    const done = "- [x] p [completion:: 2026-10-01]\n    - [x] sub [completion:: 2026-10-01]\n"
    expect(applyTaskEdit(done, 0, "- [x] p [completion:: 2026-10-01]", { kind: "done", done: false, today: DAY })).toBe(
      "- [ ] p\n    - [x] sub [completion:: 2026-10-01]\n",
    )
  })

  it("throws StaleLineError for a changed line and keeps CRLF", () => {
    expect(() => applyTaskEdit(C, 1, "   - [ ] other", { kind: "done", done: true, today: DAY })).toThrow(StaleLineError)
    expect(applyTaskEdit("- [ ] p\r\n    - [ ] s\r\n", 0, "- [ ] p", { kind: "done", done: true, today: DAY })).toBe(
      "- [x] p [completion:: 2026-10-07]\r\n    - [x] s [completion:: 2026-10-07]\r\n",
    )
  })
})
