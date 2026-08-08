// packages/core/src/__tests__/folder-hierarchy.test.ts
import { describe, it, expect } from "bun:test"
import { buildGraphFromScanner } from "../graph/builder.ts"
import { DEFAULT_SETTINGS } from "../graph/indexer.ts"
import { searchIndex, type ResultNode } from "../search/search.ts"
import type { VaultScanner, VaultFile, VaultFolder, WalkResult } from "../graph/scanner.ts"

function scanner(folders: VaultFolder[], files: VaultFile[]): VaultScanner {
  return {
    async walkVault(): Promise<WalkResult> {
      return { files, folders }
    },
    async readFile(relPath: string) {
      return { content: `# ${relPath}\n- item`, mtime: 0 }
    },
  }
}

function md(path: string): VaultFile {
  return { path, mtime: 0, type: "markdown" }
}

function folderOf(path: string, name: string): VaultFolder {
  return { path, name }
}

// A vault:
//   Projects/           (folder note Projects/Projects.md)
//   Projects/note-a.md
//   Projects/Sub/       (folder note Projects/Sub/Sub.md)
//   Projects/Sub/note-b.md
//   Areas/              (no folder note)
//   Areas/note-c.md
function sampleVault() {
  const folders = [
    folderOf("Projects", "Projects"),
    folderOf("Projects/Sub", "Sub"),
    folderOf("Areas", "Areas"),
  ]
  const files = [
    md("Projects/Projects.md"),
    md("Projects/note-a.md"),
    md("Projects/Sub/Sub.md"),
    md("Projects/Sub/note-b.md"),
    md("Areas/note-c.md"),
  ]
  return scanner(folders, files)
}

function find(nodes: ResultNode[], searchKey: string): ResultNode | undefined {
  return nodes.find(n => n.node.searchKey === searchKey)
}

function childKeys(node: ResultNode): string[] {
  return node.children.map(c => c.node.searchKey).sort()
}

describe("folder hierarchy", () => {
  it("is:folder returns top-level folders as roots, nested folders as children", async () => {
    const graph = await buildGraphFromScanner(sampleVault(), DEFAULT_SETTINGS)
    const roots = searchIndex(graph, "is:folder", ".")

    // Only the two top-level folders are roots; Sub is nested under Projects.
    const rootKeys = roots.map(r => r.node.searchKey).sort()
    expect(rootKeys).toEqual(["areas", "projects"])
  })

  it("a folder with a same-named note is represented by a folderNote node", async () => {
    const graph = await buildGraphFromScanner(sampleVault(), DEFAULT_SETTINGS)
    const roots = searchIndex(graph, "is:folder", ".")

    const projects = find(roots, "projects")!
    expect(projects.node.nodeType).toBe("folderNote")

    const areas = find(roots, "areas")!
    expect(areas.node.nodeType).toBe("folder")
  })

  it("a folder inherits its notes and subfolders as children; the folder note itself is not a child", async () => {
    const graph = await buildGraphFromScanner(sampleVault(), DEFAULT_SETTINGS)
    const roots = searchIndex(graph, "is:folder", ".")

    const projects = find(roots, "projects")!
    // note-a plus the Sub folder-note, but NOT the Projects.md folder note.
    expect(childKeys(projects)).toEqual(["note-a|", "sub"])

    const sub = projects.children.find(c => c.node.searchKey === "sub")!
    expect(sub.node.nodeType).toBe("folderNote")
    expect(childKeys(sub)).toEqual(["note-b|"])

    const areas = find(roots, "areas")!
    expect(childKeys(areas)).toEqual(["note-c|"])
  })

  it("does not expand folder containment in ordinary (non is:folder) searches", async () => {
    const graph = await buildGraphFromScanner(sampleVault(), DEFAULT_SETTINGS)
    // 'projects' matches the folder/folderNote by name, but without is:folder the
    // containment children must not appear.
    const roots = searchIndex(graph, "projects", ".")
    const folderish = roots.find(
      r => r.node.nodeType === "folder" || r.node.nodeType === "folderNote",
    )
    expect(folderish).toBeDefined()
    expect(folderish!.children).toEqual([])
  })
})
