import type { Frontmatter } from "@mdtree/core"

/**
 * Deserialize the JSON output from the WASM `parse_frontmatter` function
 * into a typed result matching the TS parser output shape.
 */
export function adaptFrontmatter(json: string): { frontmatter: Frontmatter; bodyStart: number } {
  const parsed = JSON.parse(json) as { frontmatter: Record<string, unknown>; bodyStart: number }
  return {
    frontmatter: parsed.frontmatter ?? {},
    bodyStart: parsed.bodyStart ?? 0,
  }
}
