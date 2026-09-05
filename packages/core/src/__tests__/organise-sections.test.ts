import { describe, it, expect } from "bun:test"
import { upsertOrganiseSections } from "../search/organise-sections.ts"

describe("upsertOrganiseSections", () => {
  it("creates both sections fresh at the top of a note with no frontmatter", () => {
    const content = "# My Note\nSome existing content"
    const result = upsertOrganiseSections(content, ["- [[Child]]"], ["- [[Parent]] a mention"])

    expect(result).toBe(
      "<!-- organise:children -->\n" +
      "- [[Child]]\n" +
      "<!-- /organise:children -->\n" +
      "\n" +
      "<!-- organise:mentions -->\n" +
      "- [[Parent]] a mention\n" +
      "<!-- /organise:mentions -->\n" +
      "\n" +
      "# My Note\n" +
      "Some existing content"
    )
  })

  it("inserts fresh sections after frontmatter when present", () => {
    const content = "---\ntags: [x]\n---\n# My Note"
    const result = upsertOrganiseSections(content, ["- [[Child]]"], [])

    expect(result).toBe(
      "---\n" +
      "tags: [x]\n" +
      "---\n" +
      "<!-- organise:children -->\n" +
      "- [[Child]]\n" +
      "<!-- /organise:children -->\n" +
      "\n" +
      "<!-- organise:mentions -->\n" +
      "<!-- /organise:mentions -->\n" +
      "\n" +
      "# My Note"
    )
  })

  it("inserts fresh sections after frontmatter when the note uses CRLF line endings", () => {
    const content = "---\r\ntags: [x]\r\n---\r\n# My Note"
    const result = upsertOrganiseSections(content, ["- [[Child]]"], [])

    expect(result).toBe(
      "---\r\n" +
      "tags: [x]\r\n" +
      "---\r\n" +
      "<!-- organise:children -->\r\n" +
      "- [[Child]]\r\n" +
      "<!-- /organise:children -->\r\n" +
      "\r\n" +
      "<!-- organise:mentions -->\r\n" +
      "<!-- /organise:mentions -->\r\n" +
      "\r\n" +
      "# My Note"
    )
  })

  it("finds existing CRLF-note markers in place instead of duplicating them", () => {
    const existing =
      "---\r\n" +
      "tags: [x]\r\n" +
      "---\r\n" +
      "<!-- organise:children -->\r\n" +
      "- [[Child]]\r\n" +
      "<!-- /organise:children -->\r\n" +
      "\r\n" +
      "<!-- organise:mentions -->\r\n" +
      "<!-- /organise:mentions -->\r\n"

    const result = upsertOrganiseSections(existing, ["- [[Child]]", "- [[Child2]]"], [])

    expect(result).toBe(
      "---\r\n" +
      "tags: [x]\r\n" +
      "---\r\n" +
      "<!-- organise:children -->\r\n" +
      "- [[Child]]\r\n" +
      "- [[Child2]]\r\n" +
      "<!-- /organise:children -->\r\n" +
      "\r\n" +
      "<!-- organise:mentions -->\r\n" +
      "<!-- /organise:mentions -->\r\n"
    )
  })

  it("keeps empty markers rather than omitting them when a section has no lines", () => {
    const result = upsertOrganiseSections("body", [], [])
    expect(result).toContain("<!-- organise:children -->\n<!-- /organise:children -->")
    expect(result).toContain("<!-- organise:mentions -->\n<!-- /organise:mentions -->")
  })

  it("updates an existing children section in place without touching mentions or the rest of the note", () => {
    const existing =
      "<!-- organise:children -->\n" +
      "- [[Child]]\n" +
      "<!-- /organise:children -->\n" +
      "\n" +
      "<!-- organise:mentions -->\n" +
      "- [[Parent]] old mention\n" +
      "<!-- /organise:mentions -->\n" +
      "\n" +
      "# Rest of note\n" +
      "unchanged"

    const result = upsertOrganiseSections(existing, ["- [[Child]]", "- [[Child2]]"], [])

    expect(result).toBe(
      "<!-- organise:children -->\n" +
      "- [[Child]]\n" +
      "- [[Child2]]\n" +
      "<!-- /organise:children -->\n" +
      "\n" +
      "<!-- organise:mentions -->\n" +
      "- [[Parent]] old mention\n" +
      "<!-- /organise:mentions -->\n" +
      "\n" +
      "# Rest of note\n" +
      "unchanged"
    )
  })

  it("does not duplicate a line that's already present in the section", () => {
    const existing =
      "<!-- organise:children -->\n" +
      "- [[Child]]\n" +
      "<!-- /organise:children -->\n" +
      "\n" +
      "<!-- organise:mentions -->\n" +
      "<!-- /organise:mentions -->\n"

    const result = upsertOrganiseSections(existing, ["- [[Child]]"], [])
    const childrenBody = result.split("<!-- organise:children -->\n")[1].split("\n<!-- /organise:children -->")[0]
    expect(childrenBody).toBe("- [[Child]]")
  })
})
