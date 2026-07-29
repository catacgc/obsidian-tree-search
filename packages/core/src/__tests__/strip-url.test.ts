import { describe, it, expect } from "bun:test"
import { stripUrlQueryStrings } from "../parser/inline-tokens.ts"

describe("stripUrlQueryStrings", () => {
  it("drops the query string but keeps scheme/domain/path", () => {
    expect(stripUrlQueryStrings("https://h.com/a/b?x=1&y=2")).toBe("https://h.com/a/b")
  })

  it("is a no-op for URLs without a query string", () => {
    expect(stripUrlQueryStrings("https://h.com/a/b")).toBe("https://h.com/a/b")
    expect(stripUrlQueryStrings("no urls here at all")).toBe("no urls here at all")
  })

  it("strips inside a markdown link, leaving surrounding text intact", () => {
    expect(stripUrlQueryStrings("- [name](https://h.com/p?ovuser=costache%40adobe.com) tail"))
      .toBe("- [name](https://h.com/p) tail")
  })

  it("handles multiple URLs in one line independently", () => {
    expect(stripUrlQueryStrings("http://a.com/x?q=1 and https://b.com/y?z=2"))
      .toBe("http://a.com/x and https://b.com/y")
  })
})
