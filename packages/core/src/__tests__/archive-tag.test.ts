import { describe, it, expect } from "bun:test"
import { addArchiveTag, convertLegacyArchive, hasArchiveTag, removeArchiveTag } from "../parser/archive-tag.ts"

describe("hasArchiveTag", () => {
  it("matches a whole tag after whitespace or at the start, case-insensitively", () => {
    expect(hasArchiveTag("- done #archive", "archive")).toBe(true)
    expect(hasArchiveTag("#archive first", "archive")).toBe(true)
    expect(hasArchiveTag("- done #Archive.", "archive")).toBe(true)
  })

  it("ignores longer tags, nested tags and heading links", () => {
    for (const text of ["#archived", "#archive-old", "#archive/2024", "#archive_x", "[[N#archive]]", "x#archive"]) {
      expect(hasArchiveTag(text, "archive")).toBe(false)
    }
  })
})

describe("addArchiveTag", () => {
  it("appends the tag, dropping trailing whitespace", () => {
    expect(addArchiveTag("- done  ", "archive")).toBe("- done #archive")
    expect(addArchiveTag("## 2024-12-19", "archive")).toBe("## 2024-12-19 #archive")
  })

  it("leaves a line that already has the tag (any case) unchanged", () => {
    expect(addArchiveTag("- done #Archive", "archive")).toBe("- done #Archive")
  })

  it("adds the tag to a line with only a longer tag", () => {
    expect(addArchiveTag("- done #archived", "archive")).toBe("- done #archived #archive")
  })
})

describe("removeArchiveTag", () => {
  it("removes every occurrence with its preceding whitespace, keeping other tags", () => {
    expect(removeArchiveTag("- done #archive #todo #ARCHIVE", "archive")).toBe("- done #todo")
    expect(removeArchiveTag("    - a #archive b", "archive")).toBe("    - a b")
  })

  it("keeps longer tags and heading links", () => {
    expect(removeArchiveTag("- [[N#archive]] #archived", "archive")).toBe("- [[N#archive]] #archived")
  })
})

describe("convertLegacyArchive", () => {
  it("replaces the marker with the tag at the end of its line", () => {
    expect(convertLegacyArchive("- a (meta-mdtree:: archive) b\n- c", "archive")).toEqual({ content: "- a b #archive\n- c", lines: 1 })
  })

  it("tags a line with two markers once", () => {
    expect(convertLegacyArchive("- a (meta-mdtree:: archive)(meta-mdtree::archive)", "archive").content).toBe("- a #archive")
  })

  it("doesn't add a second tag to an already tagged line", () => {
    expect(convertLegacyArchive("- a #archive (meta-mdtree:: archive)", "archive").content).toBe("- a #archive")
  })

  it("keeps CRLF line endings and counts each changed line", () => {
    expect(convertLegacyArchive("- a (meta-mdtree:: archive)\r\n- b\r\n- c (meta-mdtree:: archive)\r\n", "archive"))
      .toEqual({ content: "- a #archive\r\n- b\r\n- c #archive\r\n", lines: 2 })
  })
})
