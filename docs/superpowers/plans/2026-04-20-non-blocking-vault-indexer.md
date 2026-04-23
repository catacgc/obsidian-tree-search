# Non-Blocking Vault Indexer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the old plugin's per-batch `setTimeout(0)` yield pattern to `buildGraphFromScanner()` so vault indexing does not block the event loop.

**Architecture:** The old plugin batched files into groups of 10 and wrapped each batch in `setTimeout(0)` to yield to the event loop between batches, preventing UI freezes on large vaults. The new `buildGraphFromScanner()` in `packages/core/src/graph/builder.ts` reads and indexes files in a plain sequential `for` loop with no yielding. We add the same batch-yield pattern there: after every `BATCH_SIZE` files, schedule the next batch via `setTimeout(0)` to release the event loop.

**Tech Stack:** TypeScript, Bun test runner, no new dependencies.

---

## File Map

| File | Change |
|------|--------|
| `packages/core/src/graph/builder.ts` | Add batch-yield loop in `buildGraphFromScanner()` |
| `packages/core/src/__tests__/builder.test.ts` | New test file verifying the yield occurs |

---

### Task 1: Write a failing test for batch yielding

**Files:**
- Create: `packages/core/src/__tests__/builder.test.ts`

The test verifies that `buildGraphFromScanner` yields to the event loop during a large vault scan by checking that a microtask queued before the call can run while the scan is in progress.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/builder.test.ts
import { describe, it, expect } from "bun:test"
import { buildGraphFromScanner } from "../graph/builder.ts"
import { DEFAULT_SETTINGS } from "../graph/indexer.ts"
import type { VaultScanner, WalkResult } from "../graph/scanner.ts"

function makeScanner(fileCount: number): VaultScanner & { yieldCount: number } {
  const files = Array.from({ length: fileCount }, (_, i) => ({
    path: `note-${i}.md`,
    mtime: 0,
    type: "markdown" as const,
  }))

  let yieldCount = 0

  return {
    yieldCount: 0,
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
    // schedule a macrotask counter before the scan starts
    const interval = setInterval(() => { macrotasksFired++ }, 0)
    try {
      await buildGraphFromScanner(makeScanner(25), DEFAULT_SETTINGS)
      expect(macrotasksFired).toBeGreaterThan(0)
    } finally {
      clearInterval(interval)
    }
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
bun test packages/core/src/__tests__/builder.test.ts
```

Expected: FAIL — `macrotasksFired` is 0 because the current loop never yields.

---

### Task 2: Add batch-yield pattern to `buildGraphFromScanner`

**Files:**
- Modify: `packages/core/src/graph/builder.ts:66-69`

- [ ] **Step 3: Apply the minimal change**

Replace the plain `for` loop in `buildGraphFromScanner` (lines 66-69) with a batch-yield loop:

```typescript
// packages/core/src/graph/builder.ts

const BATCH_SIZE = 10

export async function buildGraphFromScanner(
  scanner: VaultScanner,
  settings: IndexSettings = DEFAULT_SETTINGS,
): Promise<NotesGraph> {
  const graph = new NotesGraph()
  const { files, folders } = await scanner.walkVault()

  for (const folder of folders) {
    const location = {
      path: folder.path,
      position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } },
    }
    graph.createFolderNode(folder.path, folder.name, location)
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const { content, mtime } = await scanner.readFile(file.path)
    await indexScannedFile(file.path, content, mtime, graph, settings)

    if ((i + 1) % BATCH_SIZE === 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
  }

  return graph
}
```

- [ ] **Step 4: Run the failing test — it should now pass**

```bash
bun test packages/core/src/__tests__/builder.test.ts
```

Expected: PASS — `macrotasksFired` is > 0 because `setTimeout(0)` fires between batches.

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
bun run mdtree:test
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/graph/builder.ts packages/core/src/__tests__/builder.test.ts
git commit -m "feat: yield to event loop every 10 files in buildGraphFromScanner"
```

---

## Verification

End-to-end check:

```bash
# Build the CLI binary
bun run mdtree:build

# Index a real vault — should not block the terminal for seconds
dist/mdtree index --vault ~/Documents/my-vault

# Full test suite green
bun run mdtree:test
```

No changes needed in `ObsidianVaultScanner`, `IndexedTree`, or the CLI commands — `buildGraphFromScanner` is their shared entry point, so the fix propagates automatically.
