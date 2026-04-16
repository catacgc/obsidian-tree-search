# Sample Plugin: Todoist

## Overview

Pulls all open tasks from a Todoist workspace and produces a Markdown tree indexed by mdtree.

Tree shape:
```
Todoist
  Project A
    Section 1
      [Task title](https://app.todoist.com/app/task/<id>)
        [Subtask](https://app.todoist.com/app/task/<id>)
      [Another task](https://app.todoist.com/app/task/<id>)
    Section 2
      ...
  Project B (no sections)
    [Task title](https://app.todoist.com/app/task/<id>)
    [Task title](https://app.todoist.com/app/task/<id>)
```

Only **open** tasks are included (no completed tasks, no archived projects).

## Plugin files

### `plugin.json`

```json
{
  "namespace": "todoist",
  "name": "Todoist",
  "version": "1.0.0",
  "description": "Pulls open tasks from Todoist into the mdtree graph",
  "author": "mdtree-community",
  "entrypoint": "run.ts"
}
```

### `config.schema.ts`

```typescript
import { z } from "zod"

export const schema = z.object({
  apiToken: z
    .string()
    .min(1)
    .describe("Todoist API token (Settings > Integrations > Developer)")
    .meta({ secret: true }),

  includePersonalInbox: z
    .boolean()
    .default(true)
    .describe("Include tasks from the Inbox project"),
})
```

### `run.ts`

```typescript
#!/usr/bin/env bun
/**
 * Todoist plugin for mdtree
 * Reads config from stdin (JSON), writes Markdown tree to stdout.
 */

import { schema } from "./config.schema.ts"

interface TodoistProject {
  id: string
  name: string
  parent_id: string | null
  order: number
  is_inbox_project?: boolean
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
  url: string
}

interface PagedResponse<T> {
  results: T[]
  next_cursor: string | null
}

async function fetchAll<T>(token: string, path: string): Promise<T[]> {
  const all: T[] = []
  let cursor: string | undefined
  do {
    const url = new URL(`https://api.todoist.com/api/v1/${path}`)
    if (cursor) url.searchParams.set("cursor", cursor)
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Todoist API ${res.status}: ${path}`)
    const page = await res.json() as PagedResponse<T>
    all.push(...page.results)
    cursor = page.next_cursor ?? undefined
  } while (cursor)
  return all
}

async function main() {
  // Read config from stdin
  const raw = await new Response(Bun.stdin.stream()).text()
  const config = schema.parse(JSON.parse(raw))

  const [projects, sections, tasks] = await Promise.all([
    fetchAll<TodoistProject>(config.apiToken, "projects"),
    fetchAll<TodoistSection>(config.apiToken, "sections"),
    fetchAll<TodoistTask>(config.apiToken, "tasks"),
  ])

  // Filter out inbox if configured
  const filteredProjects = projects.filter(p => {
    if (p.is_inbox_project && !config.includePersonalInbox) return false
    return true
  })

  // Build lookup maps
  const sectionsByProject = new Map<string, TodoistSection[]>()
  for (const s of sections) {
    const list = sectionsByProject.get(s.project_id) ?? []
    list.push(s)
    sectionsByProject.set(s.project_id, list)
  }

  // Only root tasks (no parent) — subtasks handled separately
  const rootTasksByProject = new Map<string, TodoistTask[]>()
  const rootTasksBySection = new Map<string, TodoistTask[]>()
  const subtasksByParent = new Map<string, TodoistTask[]>()

  for (const t of tasks) {
    if (t.parent_id) {
      const list = subtasksByParent.get(t.parent_id) ?? []
      list.push(t)
      subtasksByParent.set(t.parent_id, list)
    } else if (t.section_id) {
      const list = rootTasksBySection.get(t.section_id) ?? []
      list.push(t)
      rootTasksBySection.set(t.section_id, list)
    } else {
      const list = rootTasksByProject.get(t.project_id) ?? []
      list.push(t)
      rootTasksByProject.set(t.project_id, list)
    }
  }

  function renderTask(task: TodoistTask, depth: number): string {
    const indent = "  ".repeat(depth)
    const label = `[${task.content}](${task.url})`
    const lines = [`${indent}- ${label}`]
    const subtasks = (subtasksByParent.get(task.id) ?? []).sort((a, b) => a.order - b.order)
    for (const sub of subtasks) {
      lines.push(renderTask(sub, depth + 1))
    }
    return lines.join("\n")
  }

  const lines: string[] = ["# Todoist", ""]

  for (const project of filteredProjects.sort((a, b) => a.order - b.order)) {
    lines.push(`## ${project.name}`, "")

    const projectSections = (sectionsByProject.get(project.id) ?? []).sort(
      (a, b) => a.order - b.order,
    )

    // Tasks without a section
    const unsectioned = (rootTasksByProject.get(project.id) ?? []).sort(
      (a, b) => a.order - b.order,
    )
    for (const t of unsectioned) {
      lines.push(renderTask(t, 0))
    }

    // Sections
    for (const section of projectSections) {
      lines.push(`### ${section.name}`, "")
      const sectionTasks = (rootTasksBySection.get(section.id) ?? []).sort(
        (a, b) => a.order - b.order,
      )
      for (const t of sectionTasks) {
        lines.push(renderTask(t, 0))
      }
    }

    lines.push("")
  }

  process.stdout.write(lines.join("\n"))
}

main().catch(err => {
  console.error("todoist plugin error:", err.message)
  process.exit(1)
})
```

## Example output

Given a Todoist workspace with:
- Project: Work
  - Section: This Week
    - Task: Write proposal
      - Subtask: Draft outline
    - Task: Review PR
- Project: Personal
  - Task: Buy groceries

The plugin produces:

```markdown
# Todoist

## Work

### This Week

- [Write proposal](https://app.todoist.com/app/task/1234567890)
  - [Draft outline](https://app.todoist.com/app/task/1234567891)
- [Review PR](https://app.todoist.com/app/task/1234567892)

## Personal

- [Buy groceries](https://app.todoist.com/app/task/1234567893)
```

This gets written to `<vault>/.mdtree/plugins/todoist.md` and indexed as:

```
[[todoist]] (page)
  todoist#work (header)
    todoist#work#this week (header)
      "[write proposal](https://...)" (text, parent: todoist#work#this week)
      "[draft outline](https://...)"  (text, parent: "[write proposal](...)")
      "[review pr](https://...)"      (text, parent: todoist#work#this week)
  todoist#personal (header)
    "[buy groceries](https://...)"    (text, parent: todoist#personal)
```

Searching for `"grocery"`, `"proposal"`, or `"review"` will surface these nodes. The search key is the lowercased full text including the link label, so the label text is fully searchable. The URL is stored in the node's location and rendered as a clickable link in Raycast/UI results.
