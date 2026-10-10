import { describe, it, expect } from "bun:test"
import { hasTaskFilter, toggleTaskFilter } from "../view/search/task-filter"

describe("hasTaskFilter", () => {
    it("detects only a standalone is:task token", () => {
        expect(["is:task", "foo is:task bar"].map(hasTaskFilter)).toEqual([true, true])
        expect(["-is:task", "is:tasks", ""].map(hasTaskFilter)).toEqual([false, false, false])
    })
})

describe("toggleTaskFilter", () => {
    it("appends is:task when absent and removes it when present", () => {
        expect(toggleTaskFilter("")).toBe("is:task")
        expect(toggleTaskFilter("foo  ")).toBe("foo is:task")
        expect(toggleTaskFilter("foo is:task bar")).toBe("foo bar")
        expect(toggleTaskFilter("is:task foo")).toBe("foo")
        expect(toggleTaskFilter("foo is:task")).toBe("foo")
        expect(toggleTaskFilter("-is:task")).toBe("-is:task is:task")
    })
})
