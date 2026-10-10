---
name: build-docs
description: Regenerate the Tree Search docs site (docs/) with fresh screenshots from the example vault via live Obsidian over CDP. Use when docs, screenshots or the example vault need updating.
---

# Build the Tree Search docs

The docs site is plain Jekyll in `docs/`, rendered by GitHub Pages at https://catacgc.github.io/obsidian-tree-search/. Every screenshot is captured from the live Obsidian app, using the example vault whose entry note is `Tree Search Examples.md`.

| Piece | Path |
|---|---|
| Example vault sources (committed) | `docs/example-vault/` |
| Built vault (git-ignored) | `.docs-vault/Tree Search Docs` |
| Vault builder | `scripts/docs/build-vault.ts` (`bun run docs:vault`) |
| Screenshot capture | `scripts/docs/capture.ts` (`bun run docs:shots`) |
| Screenshots | `docs/assets/screenshots/<name>.webp` |
| Site config, nav, layout, CSS | `docs/_config.yml`, `docs/_layouts/default.html`, `docs/assets/css/style.css` |

## 1. Prerequisites

- Obsidian must run with a CDP port. Check it with `curl -fsS http://127.0.0.1:9223/json/version`.
- If it isn't running that way, **ask the user** before quitting and relaunching it. Quitting closes every open vault window. If approved:
  ```sh
  osascript -e 'quit app "Obsidian"'
  open -a Obsidian --args --remote-debugging-port=9223
  ```
- If you use a port other than 9223, set `OBSIDIAN_CDP=http://127.0.0.1:<port>`.

## 2. Run

```sh
mise run docs
# or
bun run build && bun run docs:vault && bun run docs:shots
```

- `docs:vault` rebuilds `.docs-vault/Tree Search Docs`:
  - It expands `{{date:N}}` tokens to today + N days.
  - It copies `dist/main.js`, `manifest.json` and `styles.css` into the vault's plugin directory.
  - It resets the plugin's `data.json` and parse cache.
- `docs:shots` opens the docs vault in its own Obsidian window through the `vault-open` IPC. It reloads the plugin, captures every shot and disconnects. It never quits Obsidian.
- On the very first run, Obsidian may ask to trust the vault's plugins. If `capture.ts` prints "Open … once in Obsidian via Open another vault → Open folder as vault", do that, trust the author, and rerun.

## 3. Review

- The run must end with `captured N/N`. Each failure prints `FAILED <name>: <error>`.
- `read` every changed `docs/assets/screenshots/*.webp` and check that it shows what its caption in `docs/*.md` describes. Shots can pass and still be wrong, for example a stale query, a missing popup, or the wrong row selected.
- Run `git status docs/`. Only screenshots and pages you meant to change should appear.
- Preview the site locally with `mise run docs:preview`, then open http://127.0.0.1:4000/obsidian-tree-search/. It runs the same `github-pages` gem as the Pages build (`docs/Gemfile`), installs Ruby 3.3 through mise on first use, and live-reloads when pages change. Check that the images load and the active nav item is right on every page.

## 4. Changing the scenario

Edit the files in `docs/example-vault/`, then rerun. Parser rules that matter here:

- Only a note's **leading outline** is indexed. Put the bullets first; prose comes after them. A blank line doesn't end the outline, but any other non-list, non-heading line does.
- A bullet is indexed only if it has a `[[link]]`, a `#tag` or a URL.
- Indent with 4 spaces.
- Use `{{date:N}}` in file names or content for dates relative to the capture day. This keeps recency chips (7d/30d) and `:daily` stable.

## 5. Adding a screenshot

- Add a `[name, async () => target]` entry to the `shots` list in `scripts/docs/capture.ts`. Return `lastModal()`, an element handle, or `"window"`.
- If the shot leaves state behind, undo it in `cleanup()`. Examples are an open pane, a leaf, a recency chip, or the timeline mode, which is persisted in `data.json`.
- Reference the shot from a page as `![alt](assets/screenshots/<name>.webp)`, with `*caption*` on the next line. Put `narrow` in the alt text for sidebar panes.
- Take selectors from AGENTS.md's "Surface reference".

## 6. Adding a page

Create `docs/<page>.md` with a `title:` in its front matter. Then add it to `nav` in `docs/_config.yml`. Link between pages with `.md` file names.

## 7. Publish

Only publish when the user asks. Pages builds from `main:/docs` using the legacy Jekyll build.

```sh
git push origin dev && git push origin dev:main
GH_TOKEN=$(gh auth token --user catacgc) gh api repos/catacgc/obsidian-tree-search/pages/builds/latest -q .status   # expect "built"
```

Then open https://catacgc.github.io/obsidian-tree-search/ and check that the images load on every nav page.

## Never

- Symlink `dist/` into the docs vault. The main vault's plugin directory *is* `dist/`.
- Run the capture against the user's main vault.
- Call `browser.close()` on the CDP connection. It quits Obsidian. Use `disconnect()`.
