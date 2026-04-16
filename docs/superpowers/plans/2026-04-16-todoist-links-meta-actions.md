# Todoist Links + Meta-Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Todoist plugin to emit all structure as Markdown links and add a `meta-action` inline syntax that attaches Raycast browse-actions to nodes without appearing in search or display.

**Architecture:** A new `MetaActionToken` is added to the core type system. `list-scanner` strips the `(meta-action-*::...)` syntax from `text` (keeping `searchKey` clean) while preserving the original line as `rawText` on `DvList`. `inline-tokens` extracts the triples from `rawText` into `MetaActionToken`s. Both `response.ts` files render them as `BrowseAction`s that contribute nothing to the title string. The Todoist plugin is rewritten to emit a pure list tree of links with meta-action triples on task lines.

**Tech Stack:** Bun, TypeScript, bun:test, markdown-it

---

## File Map

| File | Change |
|------|--------|
| `packages/core/src/graph/types.ts` | Add `MetaActionToken`; extend `ParsedTextToken`; add `rawText` to `DvList` |
| `packages/core/src/parser/list-scanner.ts` | Strip `(meta-action-*::...)` from `text`; populate `rawText` on `DvList` |
| `packages/core/src/parser/inline-tokens.ts` | Extract meta-action triples before markdown-it; emit `MetaActionToken`s |
| `packages/core/src/graph/indexer.ts` | Pass `item.rawText` (not `item.text`) to `parseTokens` |
| `packages/cli/src/server/response.ts` | Handle `meta_action` token in `nodeRenderer` |
| `src/view/raycast/raycast-response.ts` | Handle `meta_action` token in `nodeRenderer` |
| `plugins/todoist/run.ts` | Rewrite renderer: projects/sections as links, tasks with meta-action triples |
| `packages/core/src/__tests__/list-scanner.test.ts` | Tests for meta-action stripping + `rawText` |
| `packages/core/src/__tests__/indexer.test.ts` | Test that `searchKey` excludes meta-action syntax |

---

## Task 1: Add `MetaActionToken` to core types

**Files:**
- Modify: `packages/core/src/graph/types.ts`

- [ ] **Step 1: Add `MetaActionToken` and update `ParsedTextToken`**

In `packages/core/src/graph/types.ts`, add after the `ImageToken` type (around line 107):

```ts
export type MetaActionToken = {
  tokenType: "meta_action"
  name: string
  url: string
  icon?: string
}
```

Change `ParsedTextToken` (line 112) to:

```ts
export type ParsedTextToken = TextToken | ObsidianLinkToken | LinkToken | ImageToken | MetaActionToken
```

- [ ] **Step 2: Add `rawText` to `DvList`**

In `packages/core/src/graph/types.ts`, add `rawText` to `DvList` (around line 140):

```ts
export type DvList = {
  link: { path: string }
  text: string
  rawText: string          // ← add this line
  line: number
  position: {
    start: { line: number; col: number }
    end: { line: number; col: number }
  }
  parent?: number
  children: DvList[]
  tags: string[]
  section: { subpath: string }
  task: boolean
  completed: boolean
}
```

- [ ] **Step 3: Run type-check to verify no compilation errors**

```bash
cd /Users/costache/dev/src/costache/obsidian-tree-search
bun run packages/core/src/index.ts 2>&1 | head -20
```

Expected: no output (or only the normal module export, no errors).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/graph/types.ts
git commit -m "feat(core): add MetaActionToken type and rawText to DvList"
```

---

## Task 2: Strip meta-actions in `list-scanner` and populate `rawText`

**Files:**
- Modify: `packages/core/src/parser/list-scanner.ts`
- Modify: `packages/core/src/__tests__/list-scanner.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/__tests__/list-scanner.test.ts` at the end, before the closing `}`:

```ts
  describe("meta-action stripping", () => {
    it("strips meta-action groups from text", () => {
      const { lists } = scan(
        "- https://example.com (meta-action-name::Open)(meta-action-url::https://x.com)(meta-action-icon::globe-01-16)",
      )
      expect(lists).toHaveLength(1)
      expect(lists[0].text).toBe("https://example.com")
    })

    it("strips multiple meta-action triples from text", () => {
      const { lists } = scan(
        "- https://a.com (meta-action-name::A)(meta-action-url::https://a.com)(meta-action-name::B)(meta-action-url::https://b.com)",
      )
      expect(lists[0].text).toBe("https://a.com")
    })

    it("preserves rawText with original meta-action syntax", () => {
      const raw = "- https://example.com (meta-action-name::Open)(meta-action-url::https://x.com)"
      const { lists } = scan(raw)
      expect(lists[0].rawText).toContain("meta-action-name::Open")
    })

    it("rawText equals text when no meta-actions present", () => {
      const { lists } = scan("- https://example.com")
      expect(lists[0].rawText).toBe(lists[0].text)
    })

    it("meta-action-only line (no other content) is skipped by shouldSkip", () => {
      // A line that is ONLY meta-action props and no real content → skipped
      const { lists } = scan(
        "- (meta-action-name::X)(meta-action-url::https://x.com)",
      )
      expect(lists).toHaveLength(0)
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test packages/core/src/__tests__/list-scanner.test.ts 2>&1 | tail -20
```

Expected: 5 failures related to `rawText` and meta-action stripping.

- [ ] **Step 3: Implement stripping and `rawText` in list-scanner**

In `packages/core/src/parser/list-scanner.ts`:

Add the regex after the existing constants at the top (around line 7):

```ts
const META_ACTION_RE = /\(meta-action-[\w-]+::[^)]*\)/g
```

In the body of `scanMarkdown`, after the task-marker strip (after `if (taskMatch) text = taskMatch[2].trim()`, around line 103), add:

```ts
    // strip meta-action properties from text (they go into rawText for token parsing)
    const rawText = text
    text = text.replace(META_ACTION_RE, "").trim()
```

In the `lists.push(...)` call (around line 123), add `rawText` to the object:

```ts
    lists.push({
      link: { path: filePath },
      text,
      rawText,
      line: lineNum,
      position: {
        start: { line: lineNum, col: indent },
        end: { line: lineNum, col: line.length },
      },
      parent: parentLineNum,
      children: [],
      tags,
      section: { subpath: currentSectionSubpath },
      task: isTask,
      completed: isCompleted,
    })
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/core/src/__tests__/list-scanner.test.ts 2>&1 | tail -20
```

Expected: all tests pass, including the 5 new ones.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
bun run mdtree:test 2>&1 | tail -30
```

Expected: all 78+ tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/parser/list-scanner.ts packages/core/src/__tests__/list-scanner.test.ts
git commit -m "feat(core): strip meta-action syntax from text, preserve in rawText"
```

---

## Task 3: Parse `MetaActionToken`s in `inline-tokens.ts`

**Files:**
- Modify: `packages/core/src/parser/inline-tokens.ts`

> **Note:** There is no dedicated unit test file for `inline-tokens.ts`. The integration is tested via `indexer.test.ts` in Task 4. The token extraction logic itself is simple enough that the integration test is sufficient.

- [ ] **Step 1: Add meta-action extraction to `parseTokens`**

In `packages/core/src/parser/inline-tokens.ts`, replace the `parseTokens` function (lines 133–137):

```ts
const META_ACTION_TRIPLE_RE =
  /\(meta-action-name::([^)]*)\)\(meta-action-url::([^)]*)\)(?:\(meta-action-icon::([^)]*)\))?/g

export function parseTokens(markdownString: string): ParsedTextToken[] {
  // Extract meta-action triples first, remove them from the string for markdown-it
  const metaActions: MetaActionToken[] = []
  const cleaned = markdownString.replace(META_ACTION_TRIPLE_RE, (_, name, url, icon) => {
    metaActions.push({ tokenType: "meta_action", name, url, icon: icon || undefined })
    return ""
  })

  const md = getMd()
  const tokens = md.parseInline(cleaned.trim(), {})
  return [...parseTokenList(tokens), ...metaActions]
}
```

Also add `MetaActionToken` to the import at the top of the file (line 4):

```ts
import type { MetaActionToken, ParsedTextToken } from "../graph/types.ts"
```

- [ ] **Step 2: Run the full test suite to verify no regressions**

```bash
bun run mdtree:test 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/parser/inline-tokens.ts
git commit -m "feat(core): extract meta-action triples into MetaActionToken in parseTokens"
```

---

## Task 4: Pass `rawText` to `parseTokens` in `indexer.ts`

**Files:**
- Modify: `packages/core/src/graph/indexer.ts`
- Modify: `packages/core/src/__tests__/indexer.test.ts`

- [ ] **Step 1: Write a failing test**

Add to the `"text / list nodes"` describe block in `packages/core/src/__tests__/indexer.test.ts`:

```ts
    it("meta-action syntax does not appear in searchKey", () => {
      const g = buildGraph(
        parse(
          "- https://app.todoist.com/app/task/123 (meta-action-name::Open Task)(meta-action-url::https://app.todoist.com/app/task/123)(meta-action-icon::globe-01-16)",
          "n.md",
        ),
      )
      // The text node's searchKey must NOT contain "meta-action"
      const nodes = g.filterNodes((_, attrs) => attrs.nodeType === "text")
      expect(nodes.length).toBeGreaterThan(0)
      const textNode = g.getNodeAttributes(nodes[0]) as { searchKey: string; parsedTokens: unknown[] }
      expect(textNode.searchKey).not.toContain("meta-action")
      // But parsedTokens must contain the meta_action token
      const tokens = textNode.parsedTokens as Array<{ tokenType: string }>
      expect(tokens.some(t => t.tokenType === "meta_action")).toBe(true)
    })
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/core/src/__tests__/indexer.test.ts 2>&1 | tail -20
```

Expected: FAIL — `parsedTokens` will not contain a `meta_action` token yet because `indexer` still passes `item.text` (stripped) to `parseTokens`.

- [ ] **Step 3: Update `createNodeFromText` to use `rawText`**

In `packages/core/src/graph/indexer.ts`, in `createNodeFromText` (line 50), change:

```ts
  const parsed = parseTokens(item.text)
```

to:

```ts
  const parsed = parseTokens(item.rawText)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test packages/core/src/__tests__/indexer.test.ts 2>&1 | tail -20
```

Expected: all tests pass including the new one.

- [ ] **Step 5: Run full test suite**

```bash
bun run mdtree:test 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/graph/indexer.ts packages/core/src/__tests__/indexer.test.ts
git commit -m "feat(core): pass rawText to parseTokens so meta-action tokens are preserved"
```

---

## Task 5: Handle `meta_action` in `packages/cli/src/server/response.ts`

**Files:**
- Modify: `packages/cli/src/server/response.ts`

- [ ] **Step 1: Add `meta_action` case to `nodeRenderer`**

In `packages/cli/src/server/response.ts`, in the `nodeRenderer` function, add a new case after `case "image":` (around line 187):

```ts
    case "meta_action": {
      actions.push({
        type: "browse",
        url: token.url,
        title: truncate(token.name),
        icon: token.icon ?? Icons.globe,
      })
      return nodeRenderer(tokens.slice(1), actions, vault)
    }
```

Also add `return ""` after the switch if not already present (the current code ends with `return ""` at line 189 — leave it).

- [ ] **Step 2: Verify the file compiles**

```bash
bun build packages/cli/src/server/response.ts --target bun 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
bun run mdtree:test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/server/response.ts
git commit -m "feat(cli): render meta_action tokens as BrowseActions in response"
```

---

## Task 6: Handle `meta_action` in `src/view/raycast/raycast-response.ts`

**Files:**
- Modify: `src/view/raycast/raycast-response.ts`
- Modify: `src/graph.ts` (or wherever `ParsedTextToken` is defined in the legacy plugin)

> **Note:** This file imports types from `"src/graph"` — the legacy Obsidian plugin's own type system, not `@mdtree/core`. Check where `ParsedTextToken` is defined and add `MetaActionToken` there too.

- [ ] **Step 1: Locate `ParsedTextToken` in the legacy plugin types**

```bash
grep -n "ParsedTextToken" src/graph.ts 2>/dev/null || grep -rn "ParsedTextToken" src/ --include="*.ts" | head -10
```

Note the file and line where `ParsedTextToken` is defined.

- [ ] **Step 2: Add `MetaActionToken` to the legacy plugin types**

In whichever file defines `ParsedTextToken` in `src/`, add:

```ts
export type MetaActionToken = {
    tokenType: "meta_action"
    name: string
    url: string
    icon?: string
}
```

Then extend `ParsedTextToken` to include `| MetaActionToken`.

- [ ] **Step 3: Add `meta_action` case to `nodeRenderer` in `raycast-response.ts`**

In `src/view/raycast/raycast-response.ts`, in the `nodeRenderer` function, add a new case after `case "image":` (around line 286):

```ts
        case "meta_action":
            actions.push({
                type: "browse",
                url: token.url,
                title: truncateActionTitle(token.name),
                icon: token.icon ?? Icons.globe
            });
            return nodeRenderer(tokens.slice(1), actions, vault);
```

Note: this file uses `truncateActionTitle` (not `truncate`), and 4-space indentation matching the surrounding code.

- [ ] **Step 4: Verify TypeScript is happy**

```bash
npm run build 2>&1 | head -30
```

Expected: build succeeds (or only pre-existing warnings, no new errors).

- [ ] **Step 5: Commit**

```bash
git add src/view/raycast/raycast-response.ts src/graph.ts
git commit -m "feat(plugin): render meta_action tokens as BrowseActions in Obsidian plugin"
```

---

## Task 7: Rewrite `plugins/todoist/run.ts` — links + meta-action triples

**Files:**
- Modify: `plugins/todoist/run.ts`

This task rewrites the Markdown renderer so:
- The top-level `# Todoist` heading is removed (not needed in a pure list)
- Projects, sub-projects, and sections render as `- [Name](url)` list items
- Tasks render with their content followed by a meta-action triple
- Sub-tasks are indented children of tasks
- Nesting is driven by a recursive `renderProject` + indent-level approach

- [ ] **Step 1: Replace the renderer and main render loop**

Replace the entire content of `plugins/todoist/run.ts` with:

```ts
#!/usr/bin/env bun
/**
 * Todoist plugin for mdtree
 *
 * Reads config from stdin as JSON, writes a Markdown list tree to stdout.
 * Tree shape (all as links):
 *   - [Project](url)
 *     - [Sub-project](url)
 *       - [Section](url)
 *         - Task text http://... (meta-action-name::Open Task)(meta-action-url::...)(meta-action-icon::globe-01-16)
 *           - Sub-task ...
 *
 * Uses Todoist REST API v1 (https://developer.todoist.com/rest/v1/)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface Config {
  apiToken: string
  includePersonalInbox?: boolean
}

interface TodoistProject {
  id: string
  name: string
  parent_id: string | null
  order: number
  is_inbox_project?: boolean
  is_archived?: boolean
}

interface TodoistSection {
  id: string
  project_id: string
  name: string
  order: number
}

interface TodoistTask {
  id: string
  project_id: string
  section_id: string | null
  parent_id: string | null
  content: string
  order: number
  url?: string
}

interface PagedResponse<T> {
  results: T[]
  next_cursor: string | null
}

// ── URLs ──────────────────────────────────────────────────────────────────────

function projectUrl(project: TodoistProject): string {
  return `https://app.todoist.com/app/project/${project.id}`
}

function sectionUrl(section: TodoistSection): string {
  return `https://app.todoist.com/app/section/${section.id}`
}

function taskUrl(task: TodoistTask): string {
  return task.url ?? `https://app.todoist.com/app/task/${task.id}`
}

// ── Todoist REST API v1 ───────────────────────────────────────────────────────

const BASE = "https://api.todoist.com/api/v1"
const MAX_RETRIES = 3

async function fetchWithRetry(url: string, token: string): Promise<Response> {
  let lastErr: Error | undefined
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 500 * attempt))
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (res.status < 500) return res
      lastErr = new Error(`HTTP ${res.status}`)
    } catch (err) {
      lastErr = err as Error
    }
  }
  throw lastErr!
}

async function fetchAll<T>(token: string, path: string): Promise<T[]> {
  const all: T[] = []
  let cursor: string | undefined

  do {
    const url = new URL(`${BASE}/${path}`)
    if (cursor) url.searchParams.set("cursor", cursor)

    const res = await fetchWithRetry(url.toString(), token)
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Todoist API ${res.status} on /${path}: ${body}`)
    }

    const data = await res.json()
    if (Array.isArray(data)) {
      all.push(...(data as T[]))
      break
    } else {
      const paged = data as PagedResponse<T>
      all.push(...paged.results)
      cursor = paged.next_cursor ?? undefined
    }
  } while (cursor)

  return all
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function metaAction(name: string, url: string, icon = "globe-01-16"): string {
  return `(meta-action-name::${name})(meta-action-url::${url})(meta-action-icon::${icon})`
}

function renderTask(
  task: TodoistTask,
  subtasksByParent: Map<string, TodoistTask[]>,
  depth: number,
): string {
  const indent = "  ".repeat(depth)
  const url = taskUrl(task)
  const action = metaAction("Open Task", url)
  const lines = [`${indent}- ${task.content} ${action}`]

  const subtasks = (subtasksByParent.get(task.id) ?? []).sort((a, b) => a.order - b.order)
  for (const sub of subtasks) {
    lines.push(renderTask(sub, subtasksByParent, depth + 1))
  }

  return lines.join("\n")
}

function renderSection(
  section: TodoistSection,
  tasksBySection: Map<string, TodoistTask[]>,
  subtasksByParent: Map<string, TodoistTask[]>,
  depth: number,
): string {
  const indent = "  ".repeat(depth)
  const lines = [`${indent}- [${section.name}](${sectionUrl(section)})`]

  const tasks = (tasksBySection.get(section.id) ?? []).sort((a, b) => a.order - b.order)
  for (const t of tasks) {
    lines.push(renderTask(t, subtasksByParent, depth + 1))
  }

  return lines.join("\n")
}

function renderProject(
  project: TodoistProject,
  allProjects: TodoistProject[],
  subprojectsByParent: Map<string, TodoistProject[]>,
  sectionsByProject: Map<string, TodoistSection[]>,
  tasksByProject: Map<string, TodoistTask[]>,
  tasksBySection: Map<string, TodoistTask[]>,
  subtasksByParent: Map<string, TodoistTask[]>,
  depth: number,
): string {
  const indent = "  ".repeat(depth)
  const lines = [`${indent}- [${project.name}](${projectUrl(project)})`]

  // Tasks directly under this project (no section)
  const directTasks = (tasksByProject.get(project.id) ?? []).sort((a, b) => a.order - b.order)
  for (const t of directTasks) {
    lines.push(renderTask(t, subtasksByParent, depth + 1))
  }

  // Sections under this project
  const sections = (sectionsByProject.get(project.id) ?? []).sort((a, b) => a.order - b.order)
  for (const s of sections) {
    lines.push(renderSection(s, tasksBySection, subtasksByParent, depth + 1))
  }

  // Sub-projects
  const subprojects = (subprojectsByParent.get(project.id) ?? []).sort((a, b) => a.order - b.order)
  for (const sub of subprojects) {
    lines.push(
      renderProject(
        sub,
        allProjects,
        subprojectsByParent,
        sectionsByProject,
        tasksByProject,
        tasksBySection,
        subtasksByParent,
        depth + 1,
      ),
    )
  }

  return lines.join("\n")
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const raw = await new Response(Bun.stdin.stream()).text()
  const config = JSON.parse(raw.trim()) as Config

  if (!config.apiToken) {
    throw new Error("apiToken is required — run: mdtree plugin config todoist --vault <path>")
  }

  const includeInbox = config.includePersonalInbox ?? true

  const projects = await fetchAll<TodoistProject>(config.apiToken, "projects")
  const sections = await fetchAll<TodoistSection>(config.apiToken, "sections")
  const tasks = await fetchAll<TodoistTask>(config.apiToken, "tasks")

  // Filter: non-archived; optionally exclude inbox
  const activeProjects = projects.filter(p => {
    if (p.is_archived) return false
    if (p.is_inbox_project && !includeInbox) return false
    return true
  })

  // Build lookup maps
  const subprojectsByParent = new Map<string, TodoistProject[]>()
  for (const p of activeProjects) {
    if (p.parent_id) {
      const list = subprojectsByParent.get(p.parent_id) ?? []
      list.push(p)
      subprojectsByParent.set(p.parent_id, list)
    }
  }

  const sectionsByProject = new Map<string, TodoistSection[]>()
  for (const s of sections) {
    const list = sectionsByProject.get(s.project_id) ?? []
    list.push(s)
    sectionsByProject.set(s.project_id, list)
  }

  const tasksByProject = new Map<string, TodoistTask[]>()
  const tasksBySection = new Map<string, TodoistTask[]>()
  const subtasksByParent = new Map<string, TodoistTask[]>()

  for (const t of tasks) {
    if (t.parent_id) {
      const list = subtasksByParent.get(t.parent_id) ?? []
      list.push(t)
      subtasksByParent.set(t.parent_id, list)
    } else if (t.section_id) {
      const list = tasksBySection.get(t.section_id) ?? []
      list.push(t)
      tasksBySection.set(t.section_id, list)
    } else {
      const list = tasksByProject.get(t.project_id) ?? []
      list.push(t)
      tasksByProject.set(t.project_id, list)
    }
  }

  // Root projects (no parent_id, or parent is not in activeProjects set)
  const activeIds = new Set(activeProjects.map(p => p.id))
  const rootProjects = activeProjects
    .filter(p => !p.parent_id || !activeIds.has(p.parent_id))
    .sort((a, b) => a.order - b.order)

  const lines: string[] = []
  for (const project of rootProjects) {
    lines.push(
      renderProject(
        project,
        activeProjects,
        subprojectsByParent,
        sectionsByProject,
        tasksByProject,
        tasksBySection,
        subtasksByParent,
        0,
      ),
    )
  }

  process.stdout.write(lines.join("\n") + "\n")
}

main().catch(err => {
  console.error(`[todoist] ${(err as Error).message}`)
  process.exit(1)
})
```

- [ ] **Step 2: Verify the plugin compiles**

```bash
bun build plugins/todoist/run.ts --target bun 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
bun run mdtree:test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/todoist/run.ts
git commit -m "feat(todoist): rewrite renderer — links + meta-action triples on tasks"
```

---

## Task 8: End-to-end smoke test

This task manually verifies the full pipeline produces the right Raycast output shape. No API token needed — we use a synthetic markdown file that mimics what the Todoist plugin now emits.

- [ ] **Step 1: Write an integration test in `indexer.test.ts`**

Add a new `describe` block at the end of `packages/core/src/__tests__/indexer.test.ts`:

```ts
describe("todoist meta-action integration", () => {
  it("task with meta-action: searchKey clean, parsedTokens has meta_action", () => {
    const taskLine =
      "- [Project](https://app.todoist.com/app/project/abc123)\n" +
      "  - Buy milk https://app.todoist.com/app/task/task1 (meta-action-name::Open Task)(meta-action-url::https://app.todoist.com/app/task/task1)(meta-action-icon::globe-01-16)"

    const g = buildGraph(parse(taskLine, "todoist.md"))

    // Find the task text node
    const nodes = g.filterNodes((_, attrs) => {
      if (attrs.nodeType !== "text") return false
      const t = attrs as { searchKey: string }
      return t.searchKey.includes("buy milk")
    })
    expect(nodes.length).toBe(1)

    const node = g.getNodeAttributes(nodes[0]) as {
      searchKey: string
      parsedTokens: Array<{ tokenType: string; name?: string; url?: string }>
    }

    // searchKey must not contain meta-action syntax
    expect(node.searchKey).not.toContain("meta-action")
    expect(node.searchKey).not.toContain("Open Task")

    // parsedTokens must include the meta_action token
    const metaToken = node.parsedTokens.find(t => t.tokenType === "meta_action")
    expect(metaToken).toBeDefined()
    expect(metaToken?.name).toBe("Open Task")
    expect(metaToken?.url).toBe("https://app.todoist.com/app/task/task1")
  })

  it("project link node has no meta-action tokens", () => {
    const g = buildGraph(
      parse("- [My Project](https://app.todoist.com/app/project/abc)", "todoist.md"),
    )
    // Pure link collapses to a virtual page — no meta_action tokens
    const nodes = g.filterNodes((_, attrs) => attrs.nodeType === "page")
    expect(nodes.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the new tests**

```bash
bun test packages/core/src/__tests__/indexer.test.ts 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 3: Run full test suite one final time**

```bash
bun run mdtree:test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/__tests__/indexer.test.ts
git commit -m "test(core): end-to-end todoist meta-action integration tests"
```
