# Plugin System — Tasks

## Phase 1: Core infrastructure

- [ ] Add `plugins` + `plugin_config` SQLite tables to `VaultStore` and global `~/.config/mdtree/plugins.db`
- [ ] Implement `PluginRegistry` class: load manifests from `~/.config/mdtree/plugins/`
- [ ] Implement `runPlugin()` subprocess runner (stdin JSON → stdout Markdown)
- [ ] Implement secret field detection from Zod schema (`.meta({ secret: true })`)
- [ ] Write generated Markdown to `<vault>/.mdtree/plugins/<namespace>.md`
- [ ] Re-index generated file via `reindexFile()` after plugin run
- [ ] Enqueue plugin runs in the vault's `AsyncQueue` after vault reindex

## Phase 2: CLI commands

- [ ] `mdtree plugin install <source>` — local path + `github:owner/repo` support
- [ ] `mdtree plugin list` — table output, per-vault enabled status, mask secrets
- [ ] `mdtree plugin config <name>` — interactive TUI with secret masking
- [ ] `mdtree plugin remove <name>` — uninstall globally
- [ ] `mdtree plugin enable/disable <name>` — vault-scoped toggle
- [ ] Wire plugin commands into `packages/cli/src/main.ts`

## Phase 3: Todoist sample plugin

- [ ] Create `plugins/todoist/plugin.json`
- [ ] Create `plugins/todoist/config.schema.ts` (apiToken as secret, includePersonalInbox toggle)
- [ ] Create `plugins/todoist/run.ts` — fetch projects, sections, tasks; render Markdown tree
- [ ] Test against live Todoist API
- [ ] Document install steps in plugin README

## Phase 4: Polish

- [ ] Auto-add `.mdtree/` to `.obsidianignore` on first plugin run
- [ ] Error reporting: failed plugin runs logged but don't abort vault reindex
- [ ] `mdtree plugin config` validates against Zod schema before saving
- [ ] Handle missing config gracefully (skip plugin run, log warning)
- [ ] Tests for plugin runner, registry loader, secret masking
