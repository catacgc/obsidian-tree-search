import { describe, it, expect } from "bun:test"
import {
  attachmentExt,
  attachmentKind,
  attachmentName,
  resolveAttachmentEmbeds,
  slugify,
  OUTLINE_KEY,
} from "../edit/attachments.ts"

describe("slugify", () => {
  it("lowercases and dashes separators", () => {
    expect(slugify("New page")).toBe("new-page")
    expect(slugify("  Hello, World!! ")).toBe("hello-world")
  })
  it("strips diacritics", () => {
    expect(slugify("Ünïcødé")).toBe("unicode")
  })
  it("falls back when nothing survives", () => {
    expect(slugify("日本")).toBe("attachment")
  })
})

describe("attachmentKind / attachmentExt", () => {
  it("classifies by top-level mime type", () => {
    expect(attachmentKind("image/png")).toBe("image")
    expect(attachmentKind("audio/ogg")).toBe("audio")
    expect(attachmentKind("video/mp4")).toBe("video")
    expect(attachmentKind("application/pdf")).toBe("file")
  })
  it("prefers the file name extension, then the mime map, then the subtype", () => {
    expect(attachmentExt("Photo.JPEG", "image/jpeg")).toBe("jpeg")
    expect(attachmentExt("", "image/png")).toBe("png")
    expect(attachmentExt("", "image/jpeg")).toBe("jpg")
    expect(attachmentExt("", "image/svg+xml")).toBe("svg")
    expect(attachmentExt("", "application/vnd.ms-excel")).toBe("bin")
  })
})

describe("attachmentName", () => {
  it("uses the smallest free counter", () => {
    const taken = new Set(["new-page-image-1.png"])
    expect(attachmentName("New page", "image", "png", n => taken.has(n))).toBe("new-page-image-2.png")
    expect(attachmentName("New page", "file", "pdf", n => taken.has(n))).toBe("new-page-file-1.pdf")
  })
})

describe("resolveAttachmentEmbeds", () => {
  const png = { name: "new-page-image-1.png", ext: "png" }
  const none = () => false

  it("renames by alias and rewrites the embed keeping the alias", () => {
    const plan = resolveAttachmentEmbeds(
      { [OUTLINE_KEY]: "- [[New page]]\n    - ![[new-page-image-1.png|New Alias Text]]" },
      [png],
      none,
    )
    expect(plan.error).toBeUndefined()
    expect(plan.renames).toEqual([{ from: "new-page-image-1.png", to: "new-alias-text.png" }])
    expect(plan.trash).toEqual([])
    expect(plan.buffers[OUTLINE_KEY]).toBe("- [[New page]]\n    - ![[new-alias-text.png|New Alias Text]]")
  })

  it("matches a typo'd target by extension", () => {
    const plan = resolveAttachmentEmbeds({ [OUTLINE_KEY]: "- ![[new-age-image-1.png|X]]" }, [png], none)
    expect(plan.renames).toEqual([{ from: "new-page-image-1.png", to: "x.png" }])
    expect(plan.buffers[OUTLINE_KEY]).toBe("- ![[x.png|X]]")
  })

  it("adds the attachment extension to a bare typed target", () => {
    const plan = resolveAttachmentEmbeds({ Note: "![[whiteboard]]" }, [png], none)
    expect(plan.renames).toEqual([{ from: "new-page-image-1.png", to: "whiteboard.png" }])
    expect(plan.buffers.Note).toBe("![[whiteboard.png]]")
  })

  it("leaves untouched embeds and names alone", () => {
    const plan = resolveAttachmentEmbeds({ [OUTLINE_KEY]: "- ![[new-page-image-1.png]]" }, [png], n => n === png.name)
    expect(plan).toEqual({ renames: [], trash: [], buffers: { [OUTLINE_KEY]: "- ![[new-page-image-1.png]]" } })
  })

  it("reports an ambiguous typo when two attachments share the extension", () => {
    const buffers = { [OUTLINE_KEY]: "- ![[typo.png]]" }
    const plan = resolveAttachmentEmbeds(buffers, [png, { name: "new-page-image-2.png", ext: "png" }], none)
    expect(plan.error).toEqual({ ambiguous: "typo.png" })
    expect(plan.renames).toEqual([])
    expect(plan.buffers).toEqual(buffers)
  })

  it("does not match a target that resolves to an existing vault file", () => {
    const plan = resolveAttachmentEmbeds({ [OUTLINE_KEY]: "- ![[other.png]]" }, [png], n => n === "other.png")
    expect(plan.renames).toEqual([])
    expect(plan.trash).toEqual([png.name])
  })

  it("suffixes -2 on a collision with an existing file", () => {
    const plan = resolveAttachmentEmbeds(
      { [OUTLINE_KEY]: "- ![[new-page-image-1.png|Whiteboard]]" },
      [png],
      n => n === "whiteboard.png",
    )
    expect(plan.renames).toEqual([{ from: png.name, to: "whiteboard-2.png" }])
    expect(plan.buffers[OUTLINE_KEY]).toBe("- ![[whiteboard-2.png|Whiteboard]]")
  })

  it("suffixes on a collision with another session attachment's chosen name", () => {
    const b = { name: "new-page-image-2.png", ext: "png" }
    const plan = resolveAttachmentEmbeds(
      { [OUTLINE_KEY]: "- ![[new-page-image-1.png|Board]]\n- ![[new-page-image-2.png|Board]]" },
      [png, b],
      none,
    )
    expect(plan.renames).toEqual([
      { from: png.name, to: "board.png" },
      { from: b.name, to: "board-2.png" },
    ])
  })

  it("lets the first embed decide and rewrites every embed of the attachment", () => {
    const plan = resolveAttachmentEmbeds(
      { [OUTLINE_KEY]: "- ![[new-page-image-1.png|First]]", Note: "![[new-page-image-1.png]]" },
      [png],
      none,
    )
    expect(plan.renames).toEqual([{ from: png.name, to: "first.png" }])
    expect(plan.buffers.Note).toBe("![[first.png]]")
  })

  it("trashes unreferenced attachments", () => {
    const pdf = { name: "new-page-file-1.pdf", ext: "pdf" }
    const plan = resolveAttachmentEmbeds({ [OUTLINE_KEY]: "- ![[new-page-image-1.png]]" }, [png, pdf], none)
    expect(plan.trash).toEqual([pdf.name])
    expect(plan.renames).toEqual([])
  })

  it("reports an invalid desired name", () => {
    const plan = resolveAttachmentEmbeds({ [OUTLINE_KEY]: "- ![[a:b.png]]" }, [png], none)
    expect(plan.error).toEqual({ invalidName: "a:b.png" })
  })
})
