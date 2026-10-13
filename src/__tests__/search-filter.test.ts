import { describe, it, expect } from "bun:test"
import { parseQuery } from "@mdtree/core"
import { expandFilterRefs, filterActive, filterNameHints, filterSuggestionsAt, hasFilter, renameFilter, renameFilterRefs, saveFilter, scanFilterRefs, toggleFilterPill } from "../view/search/search-filter"
import { DEFAULT_SEARCH_FILTERS } from "../view/react-context/settings"

const F = [{ name: "Tasks", query: "is:task" }, { name: "Work", query: "is:task -home" }, { name: "Home", query: "is:task home" }]

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

describe("scanFilterRefs", () => {
    it("finds :name and -:name words, not colons inside words, quotes or links", () => {
        const refs = scanFilterRefs('a :Tasks -:work b:c 10:30 ":q" [[:z]] (:p|:h) x-:y')
        expect(refs.map(r => [r.name, r.negated])).toEqual([["Tasks", false], ["work", true], ["p", false], ["h", false]])
    })
})

describe("expandFilterRefs", () => {
    it("replaces a known reference (any case) with its query in parentheses; unknown names stay", () => {
        expect(expandFilterRefs(":Tasks foo", F, ".")).toBe("(is:task) foo")
        expect(expandFilterRefs("-:tasks", F, ".")).toBe("-(is:task)")
        expect(expandFilterRefs(":nope x", F, ".")).toBe(":nope x")
    })

    it("negates a multi-term filter as a whole", () => {
        expect(parseQuery(expandFilterRefs("-:Work", F, "."), ".")).toEqual(parseQuery("-(is:task -home)", "."))
    })

    it("expands references inside a filter's query", () => {
        expect(expandFilterRefs(":A", [{ name: "A", query: ":B x" }, { name: "B", query: "is:task" }], ".")).toBe("((is:task) x)")
    })

    it("leaves a cyclic reference as typed", () => {
        expect(expandFilterRefs(":A", [{ name: "A", query: ":B" }, { name: "B", query: ":A" }], ".")).toBe("((:A))")
    })

    it("keeps a filter with stages unwrapped so its stages stay top-level", () => {
        expect(expandFilterRefs("foo :S", [{ name: "S", query: "work . is:task" }], ".")).toBe("foo work . is:task")
    })
})

describe("filterActive", () => {
    it("is true for a non-negated reference or the filter's query text", () => {
        expect([":tasks foo", "-:Tasks", "is:task", ":Taskss"].map(q => filterActive(q, F[0]))).toEqual([true, false, true, false])
    })
})

describe("toggleFilterPill", () => {
    it("appends the reference when inactive and removes references and query text when active", () => {
        expect(toggleFilterPill("foo", F[0])).toBe("foo :Tasks")
        expect(toggleFilterPill("", F[0])).toBe(":Tasks")
        expect(toggleFilterPill("foo :tasks bar", F[0])).toBe("foo bar")
        expect(toggleFilterPill(":Tasks is:task x", F[0])).toBe("x")
        expect(toggleFilterPill("-:Tasks", F[0])).toBe("-:Tasks :Tasks")
    })
})

describe("filterSuggestionsAt", () => {
    it("offers every filter for a bare `:`, in saved order", () => {
        expect(filterSuggestionsAt(":", 1, F).map(s => s.filterName)).toEqual(["Tasks", "Work", "Home"])
    })

    it("narrows by prefix, case-insensitive, and adds a space unless one follows", () => {
        expect(filterSuggestionsAt("x :t", 4, F)).toEqual([{ label: ":Tasks", insertText: ":Tasks ", detail: "is:task", filterName: "Tasks" }])
        expect(filterSuggestionsAt(":t x", 2, F)[0].insertText).toBe(":Tasks")
    })

    it("keeps a negation", () => {
        expect(filterSuggestionsAt("-:w", 3, F)[0].insertText).toBe("-:Work ")
    })

    it("offers nothing for a complete name or a colon inside a word", () => {
        expect(filterSuggestionsAt(":tasks", 6, F)).toEqual([])
        expect(filterSuggestionsAt("a:t", 3, F)).toEqual([])
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

    it("blocks a name that can't be one query word", () => {
        expect(filterNameHints("Recent tasks", F)).toEqual([{ text: 'Use letters, digits, "-" or "_"', blocking: true }])
    })

    it("renaming: the filter's own name is free, another filter's name blocks", () => {
        expect(filterNameHints("TASKS", F, "Tasks")).toEqual([])
        expect(filterNameHints("work", F, "Tasks")).toEqual([{ text: '"Work" already exists', blocking: true }])
    })
})

describe("saveFilter", () => {
    const filters = [{ name: "Tasks", query: "is:task" }, { name: "Work", query: "#work" }]

    it("appends a new name, trimmed", () => {
        expect(saveFilter(filters, "  Recent-tasks ", "in:7d")).toEqual([...filters, { name: "Recent-tasks", query: "in:7d" }])
    })

    it("replaces the filter with the same name in place, ignoring case", () => {
        expect(saveFilter(filters, "tasks", "is:task in:30d")).toEqual([{ name: "tasks", query: "is:task in:30d" }, filters[1]])
    })
})

describe("renameFilterRefs", () => {
    it("renames :Name and -:Name references in any case, leaving quoted text, links and other names alone", () => {
        expect(renameFilterRefs(':tasks foo -:Tasks ":tasks" [[a :tasks]] :Tasks2', "Tasks", "Todo"))
            .toBe(':Todo foo -:Todo ":tasks" [[a :tasks]] :Tasks2')
    })
})

describe("renameFilter", () => {
    it("renames in place, keeps the query, and renames references in other filters", () => {
        const filters = [{ name: "Tasks", query: "is:task" }, { name: "Work", query: ":tasks #work" }]
        expect(renameFilter(filters, "tasks", " Todo ")).toEqual([{ name: "Todo", query: "is:task" }, { name: "Work", query: ":Todo #work" }])
    })
})
