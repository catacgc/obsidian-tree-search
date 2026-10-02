# Agent Instructions

## Live Obsidian Testing

For UI or plugin-runtime changes, use the real Obsidian app as a smoke test in addition to the automated tests and build. Test the changed user flow, not just that the plugin loaded.

### Prepare the plugin

1. Run `bun test` and `bun run build`. The build writes the plugin bundle to `dist/` (`main.js`, `styles.css`, `manifest.json`, and `.hotreload`).
2. Identify the intended vault before deploying. On macOS, Obsidian's vault list is in `~/Library/Application Support/obsidian/obsidian.json`; inspect its `.vaults[]` entries and the running Obsidian process rather than assuming a vault path.
3. Inspect `<vault>/.obsidian/plugins/tree-search/` before changing it. Confirm it is this development install; inspect `.hotreload` and whether its bundle files link to or share the build output. Do not overwrite a different vault's plugin or modify vault notes as test setup. Prefer an existing development vault/test data; ask before creating or changing user content.
4. If the plugin directory is not already wired to `dist/`, copy only the required built plugin files into the confirmed plugin directory. With `.hotreload` present, allow Obsidian to reload the plugin, then verify the updated command or UI is actually loaded. Compare `shasum dist/main.js <plugin dir>/main.js` to prove the deployed bundle is the new build; in a prior run the vault's plugin directory was the `dist/` output itself, so no copy was needed.

### Connect to the running app

- First check whether Obsidian already has a CDP debugging port: `pgrep -lf Obsidian` shows any `--remote-debugging-port=` flag, and `lsof -nP -iTCP:9223 -sTCP:LISTEN` plus `curl -fsS http://127.0.0.1:9223/json/version` confirm it. Inspect `/json/list` to choose the actual Obsidian page title (type `page`, e.g. `<note> - <vault> - Obsidian <version>`). Never assume port `9222` is free; it was occupied by another browser during a previous live test.
- Do not quit/restart a running Obsidian session without explicit user approval: it closes all open vault windows. If approved and no usable CDP endpoint exists, on macOS gracefully quit and relaunch with an unused port:

  ```sh
  osascript -e 'quit app "Obsidian"'
  open -a Obsidian --args --remote-debugging-port=9223
  curl -fsS http://127.0.0.1:9223/json/list
  ```

  Wait for the endpoint before attaching. Use another free port if `9223` is occupied.
- In JavaScript Eval, attach to the observed Obsidian target (use a title substring from `/json/list`):

  ```js
  const tab = await browser.open({
    name: "obsidian",
    app: {
      cdp_url: "http://127.0.0.1:9223",
      target: "<observed Obsidian title substring>",
    },
    persist: true,
  });
  display(await tab.title());
  display(await tab.evaluate(`JSON.stringify({
    vault: app.workspace.getActiveFile()?.path,
    pluginLoaded: !!app.plugins.plugins["tree-search"],
    commands: Object.keys(app.commands.commands).filter(id => id.startsWith("tree-search")),
  })`));
  ```

  Confirm the expected vault and plugin before interacting. Use `tab.evaluate(...)` for Obsidian's page context (`app`, DOM); use tab helpers such as `waitForSelector`, `fill`, `click`, `press`, `observe`, and `screenshot` for UI actions and evidence.

### Exercise and verify the changed flow

- Open the relevant command by its currently registered ID, rather than assuming a command name or which view is active. For example, the Search modal command was `tree-search:search-modal` in a prior run:

  ```js
  await tab.evaluate(`app.commands.executeCommandById("tree-search:search-modal")`);
  await tab.waitForSelector(".modal input[type=search]");
  ```

- Use a harmless query known to match the selected test vault. Wait for results, exercise the changed control and its important boundary/keyboard interaction, then inspect the actual DOM and capture a screenshot when layout or styling changed. For flows available in multiple surfaces (such as Search modal, Search pane, or Quick Link), test only the affected surfaces and confirm unaffected surfaces remain unchanged when relevant.
- If a previously used query remains in a React-controlled input and `fill` does not clear it, set the native input value and dispatch a bubbling `input` event, or select all and type. Do not mistake stale results for the new query:

  ```js
  const setQuery = (sel, q) => tab.evaluate(`(() => {
    const i = document.querySelector(${JSON.stringify(sel)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(q)});
    i.dispatchEvent(new Event("input", {bubbles: true}));
  })()`);
  ```

- Close modals the way a user does and confirm it: focus the modal input, `await tab.press("Escape")`, then check `document.querySelectorAll(".modal-container").length === 0`. Clicking `.modal-close-button` via `evaluate` left the modal open in a prior run, so a "reopen" check would have tested nothing.
- Persisted plugin state lives in `data.json`: read it with `await app.plugins.plugins["tree-search"].loadData()`. To test persistence across plugin reload without restarting Obsidian, run `await app.plugins.disablePlugin("tree-search"); await app.plugins.enablePlugin("tree-search")`, wait for the views to remount, then re-enter the query and re-read the DOM; do not reuse element handles or results from before the reload.
- Check the visible result/state and `await tab.errors()` after the interaction. A loaded plugin or successful build alone is not proof that the behavior works. Report UI verification as unavailable if no safe live app/target can be reached; do not claim it was tested.
- Restore the modal/view state where practical, including persisted state the test changed (e.g. toggle modes back so `data.json` matches its starting values; inspect it before the test), and release the automation handle with `await browser.close({ name: "obsidian" })`. Closing the CDP tab handle releases automation only; it does not quit Obsidian. Do not terminate the app as cleanup.

### Surface reference

Observed in prior runs; re-check command IDs with `app.commands.commands` if something fails to match.

| Surface | Open with | DOM root |
| --- | --- | --- |
| Search pane | `tree-search:parse-tree` | `.workspace-leaf-content[data-type="tree-search"]` (view type `tree-search`) |
| Search modal | `tree-search:search-modal` | `.modal`, input `.modal input[type=search]` |
| Quick Link | `tree-search:quick-link-modal` | `.modal` |

- Tree/Timeline toggle: button with `aria-label` `"Show timeline"` (tree mode) or `"Show tree"` (timeline mode). Shown only in the Search pane and Search modal; Quick Link has none.
- Timeline rows are `.ts-timeline-row`, and they also carry `.tree-node`, so count `.ts-timeline-row` to tell modes apart rather than `.tree-node`. Recency chips are `.ts-timeline-chip` (active chip has `.is-active`).
- Per-view Tree/Timeline modes persist in `data.json` under `searchViewModes`, keyed by view name (`"modal"`, `"Search"`).
