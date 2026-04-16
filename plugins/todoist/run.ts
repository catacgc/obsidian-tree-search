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
