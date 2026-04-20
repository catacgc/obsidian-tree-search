import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { parseVaultFile } from "../../parser/vault-file.ts"
import { indexSinglePage, DEFAULT_SETTINGS } from "../../graph/indexer.ts"
import { NotesGraph } from "../../graph/graph.ts"
import { searchIndex, type ResultNode } from "../../search/search.ts"

const FIXTURES_DIR = join(import.meta.dir, "fixtures")
const MTIME = 1_700_000_000_000

export function loadFixture(scenario: string): NotesGraph {
  const dir = join(FIXTURES_DIR, scenario)
  const g = new NotesGraph()
  for (const file of readdirSync(dir).filter(f => f.endsWith(".md")).sort()) {
    const content = readFileSync(join(dir, file), "utf8")
    const page = parseVaultFile(content, file, MTIME)
    indexSinglePage(page, g, DEFAULT_SETTINGS)
  }
  return g
}

export function search(g: NotesGraph, query: string): ResultNode[] {
  return searchIndex(g, query, DEFAULT_SETTINGS.searchSeparator)
}

export function searchKeys(g: NotesGraph, query: string): string[] {
  return collectKeys(search(g, query))
}

function collectKeys(nodes: ResultNode[]): string[] {
  const keys: string[] = []
  function walk(nodes: ResultNode[]): void {
    for (const n of nodes) {
      keys.push(n.node.searchKey)
      walk(n.children)
    }
  }
  walk(nodes)
  return keys
}
