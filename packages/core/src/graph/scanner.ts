export type VaultFile = {
  path: string  // vault-relative, e.g. "folder/note.md"
  mtime: number
  type: "markdown" | "canvas" | "attachment"
}

export type VaultFolder = {
  path: string  // vault-relative, e.g. "folder/sub"
  name: string  // basename
}

export type WalkResult = {
  files: VaultFile[]
  folders: VaultFolder[]
}

export interface VaultScanner {
  walkVault(): Promise<WalkResult>
  readFile(relPath: string): Promise<{ content: string; mtime: number }>
}
