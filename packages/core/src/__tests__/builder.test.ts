// packages/core/src/__tests__/builder.test.ts
import { describe, it, expect } from "bun:test"
import { buildGraphFromScanner } from "../graph/builder.ts"
import { DEFAULT_SETTINGS } from "../graph/indexer.ts"
import type { VaultScanner, WalkResult } from "../graph/scanner.ts"

function makeScanner(fileCount: number): VaultScanner {
  const files = Array.from({ length: fileCount }, (_, i) => ({
    path: `note-${i}.md`,
    mtime: 0,
    type: "markdown" as const,
  }))

  return {
    async walkVault(): Promise<WalkResult> {
      return { files, folders: [] }
    },
    async readFile(relPath: string) {
      return { content: `# ${relPath}\n- item`, mtime: 0 }
    },
  }
}

describe("buildGraphFromScanner", () => {
  it("yields to the event loop at least once when scanning 25 files", async () => {
    let macrotasksFired = 0
    const interval = setInterval(() => { macrotasksFired++ }, 0)
    try {
      await buildGraphFromScanner(makeScanner(25), DEFAULT_SETTINGS)
      expect(macrotasksFired).toBeGreaterThan(0)
    } finally {
      clearInterval(interval)
    }
  })
})
