// Captures the docs screenshots (docs/assets/screenshots/*.webp) from the live
// Obsidian app over CDP, using the example vault built by build-vault.ts.
// Obsidian must run with --remote-debugging-port (default 9223, override with
// OBSIDIAN_CDP). Never closes the browser: that would quit Obsidian.
import puppeteer, { type Browser, type ElementHandle, type Page } from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const CDP = process.env.OBSIDIAN_CDP ?? "http://127.0.0.1:9223";
const VAULT = resolve(".docs-vault/Tree Search Docs");
const VAULT_TITLE = " - Tree Search Docs - Obsidian";
const OUT = "docs/assets/screenshots";
const SEARCH_PANE = '.workspace-leaf-content[data-type="tree-search"]';
const SEARCH_INPUT = ".modal input[type=search]";

let browser: Browser;
try {
    // Fail a hung evaluate in 30 s instead of puppeteer's 180 s default.
    browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null, protocolTimeout: 30_000 });
} catch {
    console.error('Obsidian must run with --remote-debugging-port=9223 (see AGENTS.md "Live Obsidian Testing")');
    process.exit(1);
}

async function findVaultPage(): Promise<Page | undefined> {
    for (const p of await browser.pages()) {
        // Popouts (e.g. a Settings window) share the vault title but load about:blank.
        if (p.url().startsWith("app://") && (await p.title()).includes(VAULT_TITLE)) return p;
    }
}

let found = await findVaultPage();
if (!found) {
    let opened: unknown = false;
    for (const p of await browser.pages()) {
        if (/Obsidian \d[\d.]*$/.test(await p.title()) && p.url().startsWith("app://")) {
            opened = await p.evaluate(`window.electron.ipcRenderer.sendSync("vault-open", ${JSON.stringify(VAULT)}, false)`);
            break;
        }
    }
    for (let i = 0; opened === true && !found && i < 40; i++) {
        await Bun.sleep(500);
        found = await findVaultPage();
    }
    if (!found) {
        console.error(`Open "${VAULT}" once in Obsidian via Open another vault → Open folder as vault, trust the author, then rerun.`);
        browser.disconnect();
        process.exit(1);
    }
}
const page: Page = found;

// Evaluates a JS expression in the vault window's page context (where `app` lives).
const ev = <T = unknown>(js: string) => page.evaluate(js) as Promise<T>;
const cmd = (id: string) => ev(`app.commands.executeCommandById(${JSON.stringify(id)})`);

async function setQuery(inputSel: string, q: string) {
    await page.waitForSelector(inputSel, { timeout: 10_000 });
    await ev(`(() => {
        const i = [...document.querySelectorAll(${JSON.stringify(inputSel)})].pop();
        i.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(q)});
        i.dispatchEvent(new Event("input", {bubbles: true}));
    })()`);
}

async function lastModal(): Promise<ElementHandle<Element>> {
    const h = await page.evaluateHandle(`[...document.querySelectorAll(".modal-container .modal")].pop()`);
    const el = h.asElement() as ElementHandle<Element> | null;
    if (!el) throw new Error("no open modal");
    return el;
}

// Waits for result rows inside the last element matching scopeSel.
async function waitRows(scopeSel: string, rowSel = ".tree-node") {
    await page.waitForFunction(
        (s, r) => ([...document.querySelectorAll(s)].pop()?.querySelectorAll(r).length ?? 0) > 0,
        { timeout: 15_000 }, scopeSel, rowSel);
    await Bun.sleep(400);
}

const modalCount = () => ev<number>(`document.querySelectorAll(".modal-container").length`);

async function clickAria(label: string) {
    await ev(`[...document.querySelectorAll(${JSON.stringify(`[aria-label="${label}"]`)})].pop()?.click()`);
    await Bun.sleep(400);
}

async function chip(label: string) {
    await ev(`[...document.querySelectorAll(".ts-timeline-chip")].filter(c => c.textContent.trim() === ${JSON.stringify(label)}).pop()?.click()`);
    await Bun.sleep(400);
}

async function selectRow(scopeSel: string, text: string) {
    const h = await page.evaluateHandle(
        (s, t) => [...([...document.querySelectorAll(s)].pop()?.querySelectorAll(".tree-node") ?? [])]
            .find(n => n.textContent?.includes(t)),
        scopeSel, text);
    const el = h.asElement() as ElementHandle<Element> | null;
    if (!el) throw new Error(`no row containing "${text}"`);
    // Clicking the already-selected row opens it (and closes a modal), so only click to select.
    if (!(await el.evaluate(n => n.querySelector(".ts-list-line")?.classList.contains("highlight")))) await el.click();
    await Bun.sleep(300);
}

async function alt(code: "KeyA" | "Enter") {
    await page.keyboard.down("Alt");
    await page.keyboard.press(code);
    await page.keyboard.up("Alt");
}

async function escapeAll() {
    for (let i = 0; i < 5 && (await modalCount()) > 0; i++) {
        await page.keyboard.press("Escape");
        await Bun.sleep(300);
    }
}

async function openNote(path: string, mode: "source" | "preview") {
    await ev(`(async () => {
        const f = app.vault.getFileByPath(${JSON.stringify(path)});
        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(f);
        await leaf.setViewState({type: "markdown", state: {file: ${JSON.stringify(path)}, mode: ${JSON.stringify(mode)}, source: ${mode === "source"}}});
        app.workspace.setActiveLeaf(leaf, {focus: true});
    })()`);
    await Bun.sleep(500);
}

async function searchModal(q: string) {
    await cmd("tree-search:search-modal");
    await setQuery(SEARCH_INPUT, q);
    await waitRows(".modal");
}

async function element(sel: string): Promise<ElementHandle<Element>> {
    const el = await page.waitForSelector(sel, { timeout: 10_000 });
    if (!el) throw new Error(`missing ${sel}`);
    return el;
}

// ── Prepare the vault window ────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });
await page.bringToFront();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
if ((await ev<number>("innerWidth")) !== 1280) console.warn("warning: viewport is not 1280px wide; element shots are unaffected");

await ev(`(async () => {
    if (!app.plugins.isEnabled()) await app.plugins.setEnable(true);
    await app.plugins.loadManifests();
    await app.plugins.disablePlugin("tree-search");
    await app.plugins.enablePluginAndSave("tree-search");
})()`);
await escapeAll();
if (!(await ev<boolean>(`!!app.internalPlugins.plugins["daily-notes"]?.enabled`))) {
    console.error("Enable the core Daily Notes plugin in the docs vault: :daily and Quick Add need it.");
    browser.disconnect();
    process.exit(1);
}
await ev(`(async () => {
    app.workspace.leftSplit.collapse();
    app.workspace.rightSplit.collapse();
    app.workspace.iterateRootLeaves(l => l.detach());
    await app.workspace.openLinkText("Tree Search Examples", "", false);
})()`);
// The reload above does a full graph build; wait until search returns rows.
await cmd("tree-search:search-modal");
await setQuery(SEARCH_INPUT, "apollo");
await page.waitForSelector(".modal .tree-node", { timeout: 30_000 });
await escapeAll();

// ── Shots ───────────────────────────────────────────────────────────────────
type Target = ElementHandle<Element> | "window";
const shots: [name: string, run: () => Promise<Target>][] = [
    ["workspace-overview", async () => {
        await openNote("Tree Search Examples.md", "source");
        await cmd("tree-search:parse-tree");
        await setQuery(`${SEARCH_PANE} input[type=search]`, "project apollo");
        await waitRows(SEARCH_PANE);
        return "window";
    }],
    ["search-modal", async () => { await searchModal("apollo"); return lastModal(); }],
    ["search-empty-help", async () => {
        await cmd("tree-search:search-modal");
        await setQuery(SEARCH_INPUT, "");
        await Bun.sleep(500);
        return lastModal();
    }],
    ["note-source-apollo", async () => {
        await openNote("Work/Project Apollo.md", "source");
        return element(".workspace-leaf.mod-active .view-content");
    }],
    ["tree-apollo", async () => {
        await ev(`(async () => {
            const leaf = app.workspace.getLeaf(true);
            await leaf.setViewState({type: "tree-search", active: true});
            app.workspace.setActiveLeaf(leaf, {focus: true});
            window.__docsLeaf = leaf;
        })()`);
        await setQuery(".workspace-leaf.mod-active input[type=search]", "project apollo");
        await waitRows(".workspace-leaf.mod-active");
        return element(".workspace-leaf.mod-active .view-content");
    }],
    ["projects-tree", async () => { await searchModal("projects"); return lastModal(); }],
    ["archive-hidden", async () => { await searchModal("hermes"); return lastModal(); }],
    ["archive-revealed", async () => { await searchModal("hermes is:archived"); return lastModal(); }],
    ["query-stage", async () => { await searchModal("apollo . alice"); return lastModal(); }],
    ["query-tasks", async () => { await searchModal("is:task"); return lastModal(); }],
    ["query-tree-scope", async () => { await searchModal("[[Project Apollo]]"); return lastModal(); }],
    ["query-daily", async () => { await searchModal(":daily"); return lastModal(); }],
    ["recency-tree", async () => {
        await searchModal("apollo | hermes");
        await chip("7d");
        return lastModal();
    }],
    ["timeline", async () => {
        await searchModal("is:text");
        await clickAria("Show timeline");
        await chip("30d");
        await waitRows(".modal", ".ts-timeline-row");
        return lastModal();
    }],
    ["action-panel", async () => {
        await searchModal("apollo");
        await selectRow(".modal", "Kickoff with Alice and Bob");
        await ev(`[...[...document.querySelectorAll(".modal")].pop().querySelectorAll("*")]
            .find(e => e.children.length === 0 && e.textContent.trim() === "Actions")?.click()`);
        await Bun.sleep(400);
        return lastModal();
    }],
    ["quick-add-append", async () => {
        await searchModal("project apollo");
        await alt("KeyA");
        // Quick Add replaces the Search modal's content (title "Add to <date>"), not a new modal.
        const editor = await element(".modal .cm-content");
        await Bun.sleep(500);
        await editor.focus();
        // Caret to the end of the draft: the empty child bullet under [[Project Apollo]].
        await page.keyboard.down("Meta");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.up("Meta");
        await page.keyboard.type("Confirmed the launch date");
        await Bun.sleep(500);
        return lastModal();
    }],
    ["insert-link-autocomplete", async () => {
        // Continues the Quick Add draft from the previous shot; never type into a note.
        if (!(await page.$(".modal .cm-content"))) throw new Error("Quick Add is not open");
        // Suggestions start at 3 characters after `[[`.
        await page.keyboard.type(" with [[bob");
        await Bun.sleep(800);
        return lastModal();
    }],
    ["alt-edit", async () => {
        await searchModal("budget");
        await selectRow(".modal", "Budget approved");
        await alt("Enter");
        await element(".modal .cm-content");
        await Bun.sleep(600);
        return lastModal();
    }],
    ["quick-link", async () => {
        await openNote("Tree Search Examples.md", "source");
        await cmd("tree-search:quick-link-modal");
        await setQuery(SEARCH_INPUT, "apollo");
        await waitRows(".modal");
        return lastModal();
    }],
    ["file-context", async () => {
        await openNote("Contacts/Alice.md", "source");
        await cmd("tree-search:file-context");
        await waitRows('.workspace-leaf-content[data-type="file-context"]');
        return element('.workspace-leaf-content[data-type="file-context"]');
    }],
    ["consolidate", async () => {
        await openNote("Work/Project Apollo.md", "source");
        await cmd("tree-search:organise-notes");
        await Bun.sleep(1000);
        return element('.workspace-leaf-content[data-type="organise-notes"]');
    }],
    ["code-block", async () => {
        await openNote("Work/Project Apollo.md", "preview");
        const row = await page.waitForSelector(".workspace-leaf.mod-active .markdown-preview-view .block-language-tree-context .tree-node", { timeout: 10_000, visible: true });
        const block = await row?.evaluateHandle(n => n.closest(".block-language-tree-context"));
        const el = block?.asElement() as ElementHandle<Element> | null | undefined;
        if (!el) throw new Error("tree-context block not rendered");
        await el.evaluate(n => n.scrollIntoView({ block: "center" }));
        await Bun.sleep(400);
        return el;
    }],
    ["settings", async () => {
        await ev(`app.setting.open(); app.setting.openTabById("tree-search")`);
        await Bun.sleep(800);
        if (await page.$(".modal.mod-settings")) return element(".modal.mod-settings .vertical-tab-content");
        // Newer Obsidian opens Settings in its own popout window.
        for (const p of await browser.pages()) {
            if ((await p.title()).startsWith("Settings" + VAULT_TITLE)) {
                const el = await p.waitForSelector(".vertical-tab-content", { timeout: 10_000 });
                // The pane fills the window; shrink it to its content so the shot has no blank tail.
                await el?.evaluate(n => { const s = (n as HTMLElement).style; s.height = "auto"; s.flex = "none"; s.paddingBottom = "24px"; });
                if (el) return el;
            }
        }
        throw new Error("settings window not found");
    }],
];

// Undo per-shot state so the next shot starts from a clean workspace.
async function cleanup(name: string) {
    // insert-link-autocomplete keeps typing into this Quick Add draft.
    if (name === "quick-add-append") return;
    await escapeAll();
    if (name === "workspace-overview" || name === "file-context") await ev(`app.workspace.rightSplit.collapse()`);
    if (name === "tree-apollo") await ev(`window.__docsLeaf?.detach(); delete window.__docsLeaf`);
    if (name === "consolidate") await ev(`app.workspace.detachLeavesOfType("organise-notes")`);
    if (name === "settings") await ev(`app.setting.close()`);
    if (name === "timeline") {
        // Keep the persisted modal mode at tree.
        await searchModal("is:text");
        await clickAria("Show tree");
        await chip("All");
        await escapeAll();
    }
    if (name === "recency-tree") {
        await searchModal("apollo");
        await chip("All");
        await escapeAll();
    }
}

const failed: string[] = [];
for (const [name, run] of shots) {
    // One retry from a clean state: the live app occasionally drops a step.
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const target = await run();
            const path = `${OUT}/${name}.webp` as const;
            // Park the pointer so no row is shown in hover highlight.
            await page.mouse.move(1, 1);
            if (target === "window") await page.screenshot({ path, type: "webp", quality: 90 });
            else await target.screenshot({ path, type: "webp", quality: 90 });
            console.log(`ok ${name}`);
            break;
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            if (attempt === 1 && name !== "insert-link-autocomplete") {
                console.warn(`retrying ${name}: ${message}`);
                await escapeAll().catch(() => {});
                continue;
            }
            console.error(`FAILED ${name}: ${message}`);
            failed.push(name);
            process.exitCode = 1;
        }
    }
    try {
        await cleanup(name);
    } catch (e) {
        console.error(`cleanup after ${name} failed: ${e instanceof Error ? e.message : e}`);
    }
}

await escapeAll();
await openNote("Tree Search Examples.md", "source");
browser.disconnect();
console.log(`captured ${shots.length - failed.length}/${shots.length}${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
