import { describe, it, expect } from "bun:test"
import { filterNameHints, hasFilter, saveFilter, toggleFilter } from "../view/search/search-filter"
import { DEFAULT_SEARCH_FILTERS } from "../view/react-context/settings"

describe("hasFilter", () => {
    it("detects only a standalone is:task token", () => {
        expect(["is:task", "foo is:task bar"].map(q => hasFilter(q, "is:task"))).toEqual([true, true])
        expect(["-is:task", "is:tasks", ""].map(q => hasFilter(q, "is:task"))).toEqual([false, false, false])
    })

    it("matches a multi-token filter across any whitespace run", () => {
        expect(hasFilter("a is:task\t#work b", "is:task #work")).toBe(true)
        expect(hasFilter("a is:task b #work", "is:task #work")).toBe(false)
    })

    it("treats regex specials literally", () => {
        expect(hasFilter("x (a | b)", "(a | b)")).toBe(true)
        expect(hasFilter("x a", "(a | b)")).toBe(false)
    })

    it("never matches a blank filter", () => {
        expect(hasFilter("foo", "  ")).toBe(false)
    })
})

describe("toggleFilter", () => {
    it("appends is:task when absent and removes it when present", () => {
        expect(toggleFilter("", "is:task")).toBe("is:task")
        expect(toggleFilter("foo  ", "is:task")).toBe("foo is:task")
        expect(toggleFilter("foo is:task bar", "is:task")).toBe("foo bar")
        expect(toggleFilter("is:task foo", "is:task")).toBe("foo")
        expect(toggleFilter("foo is:task", "is:task")).toBe("foo")
        expect(toggleFilter("-is:task", "is:task")).toBe("-is:task is:task")
    })

    it("appends a multi-token filter as stored and removes it whole", () => {
        expect(toggleFilter("foo", " is:task  #work ")).toBe("foo is:task  #work")
        expect(toggleFilter("a is:task #work b", "is:task #work")).toBe("a b")
    })
})

describe("filterNameHints", () => {
    it("blocks a blank name", () => {
        expect(filterNameHints("  ", DEFAULT_SEARCH_FILTERS)).toEqual([{text: "Name the filter", blocking: true}])
    })

    it("warns without blocking when the name exists, ignoring case and spacing", () => {
        expect(filterNameHints(" tasks ", DEFAULT_SEARCH_FILTERS)).toEqual([{text: '"Tasks" already exists', blocking: false}])
    })

    it("accepts a new name", () => {
        expect(filterNameHints("Work", DEFAULT_SEARCH_FILTERS)).toEqual([])
    })
})

describe("saveFilter", () => {
    const filters = [{ name: "Tasks", query: "is:task" }, { name: "Work", query: "#work" }]

    it("appends a new name, normalizing its spacing", () => {
        expect(saveFilter(filters, "  Recent   tasks ", "in:7d")).toEqual([...filters, { name: "Recent tasks", query: "in:7d" }])
    })

    it("replaces the filter with the same name in place, ignoring case", () => {
        expect(saveFilter(filters, "tasks", "is:task in:30d")).toEqual([{ name: "tasks", query: "is:task in:30d" }, filters[1]])
    })
})
