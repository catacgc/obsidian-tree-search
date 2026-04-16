# Todoist Plugin: Links + Meta-Actions Design

**Date:** 2026-04-16  
**Status:** Approved

## Overview

The Todoist plugin currently renders projects as `## Headings` and tasks as plain text list items. This design changes the plugin to emit everything as Markdown links, and introduces a `meta-action` inline syntax that attaches Raycast actions to nodes without polluting search or display.

---

## 1. Todoist Plugin Output Format

The plugin emits a pure Markdown list tree. Every structural node (project, sub-project, section) becomes a Markdown link. Tasks carry their content as-is (which may include inline URLs) followed by zero or more meta-action triples.

### Hierarchy

```
- [Project](https://app.todoist.com/app/project/<id>)
  - [Sub-project](https://app.todoist.com/app/project/<id>)
    - [Section](https://app.todoist.com/app/section/<id>)
      - Task Text http://inline-link (meta-action-name::Open Task)(meta-action-url::https://app.todoist.com/app/task/<id>)(meta-action-icon::globe-01-16)
        - Sub-task with meta-actions
  - [Section](...)            ← sections can sit directly under a project
    - Task with meta-actions
  - Task with meta-actions    ← tasks can sit directly under a project/sub-project
```

Rules:
- Projects and sub-projects are linked by `parent_id` (already tracked by the API fetch).
- Sections belong to a project; tasks belong to a section, project, or sub-project.
- Sub-tasks are children of tasks (tracked by `parent_id` on tasks).

### Meta-action triple syntax

Each meta-action is a contiguous group of three `(key::value)` properties on the same line:

```
(meta-action-name::Open Task)(meta-action-url::https://...)(meta-action-icon::globe-01-16)
```

- `meta-action-name` — action title shown in Raycast
- `meta-action-url` — URL opened when the action is triggered (type: `browse`)
- `meta-action-icon` — Raycast icon string (optional; defaults to `globe-01-16`)

Multiple triples per line are allowed. A partial triple (name without url) is silently dropped.

---

## 2. New Token Type: `MetaActionToken`

**File:** `packages/core/src/graph/types.ts`

```ts
export type MetaActionToken = {
  tokenType: "meta_action"
  name: string
  url: string
  icon?: string
}
```

`ParsedTextToken` becomes:

```ts
export type ParsedTextToken =
  | TextToken
  | ObsidianLinkToken
  | LinkToken
  | ImageToken
  | MetaActionToken
```

---

## 3. Parsing in `inline-tokens.ts`

**File:** `packages/core/src/parser/inline-tokens.ts`

Before passing the raw string to markdown-it, `parseTokens` extracts all meta-action triples with a preprocessing step:

```ts
const META_ACTION_TRIPLE_RE =
  /\(meta-action-name::([^)]*)\)\(meta-action-url::([^)]*)\)(?:\(meta-action-icon::([^)]*)\))?/g
```

Extracted triples become `MetaActionToken`s appended to the token list. The remainder (with triples removed) is passed to markdown-it for normal parsing.

Partial triples (name without url, or url without name) are silently dropped.

---

## 4. Stripping in `list-scanner.ts`

**File:** `packages/core/src/parser/list-scanner.ts`

A single regex strips all `(meta-action-*::...)` groups from `text` before `shouldSkip`, tag extraction, and `DvList` construction:

```ts
const META_ACTION_RE = /\(meta-action-\w+::[^)]*\)/g

// applied after task-marker strip:
text = text.replace(META_ACTION_RE, "").trim()
```

This ensures:
- `searchKey` (built from `item.text`) never contains meta-action syntax.
- Tags, inline links, and `shouldSkip` all operate on clean text.

`createNodeFromText` in `indexer.ts` calls `parseTokens(item.text)` — by the time it receives `item`, `item.text` is already stripped. To preserve meta-action triples for token parsing, `list-scanner` stores the pre-strip line as `item.rawText` on `DvList`, and `createNodeFromText` passes `item.rawText` to `parseTokens` instead of `item.text`.

---

## 5. Rendering in `response.ts`

**Files:**
- `packages/cli/src/server/response.ts`
- `src/view/raycast/raycast-response.ts`

In `nodeRenderer`, a new case for `meta_action`:

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

`meta_action` tokens contribute **nothing to the title string** — only to the `actions` array. The rendered title is exactly what the user sees in Raycast, with no meta-action syntax leakage.

---

## 6. Changes Summary

| File | Change |
|------|--------|
| `plugins/todoist/run.ts` | Render projects/sub-projects/sections as `- [Name](url)` list items; append meta-action triples to task lines |
| `packages/core/src/graph/types.ts` | Add `MetaActionToken`; extend `ParsedTextToken` union; add `rawText` to `DvList` |
| `packages/core/src/parser/inline-tokens.ts` | Extract meta-action triples before markdown-it; return as `MetaActionToken`s |
| `packages/core/src/parser/list-scanner.ts` | Strip `(meta-action-*::...)` groups from `text`; populate `rawText` on `DvList` |
| `packages/core/src/graph/indexer.ts` | Pass `item.rawText` (not `item.text`) to `parseTokens` |
| `packages/cli/src/server/response.ts` | Handle `meta_action` token case in `nodeRenderer` |
| `src/view/raycast/raycast-response.ts` | Handle `meta_action` token case in `nodeRenderer` |

---

## 7. Out of Scope

- Completed tasks (already excluded by the API fetch — only open tasks are returned).
- Archived projects (already filtered).
- Keyboard shortcuts for meta-actions (Raycast assigns these automatically or the user can configure them).
