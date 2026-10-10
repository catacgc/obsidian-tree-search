// Builds the docs example vault (.docs-vault/Tree Search Docs) from
// docs/example-vault/, expanding {{date:N}} tokens (today + N days, local
// time, YYYY-MM-DD) in paths and contents, and installs the plugin from dist/.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SRC = "docs/example-vault";
const DEST = ".docs-vault/Tree Search Docs";
const PLUGIN = DEST + "/.obsidian/plugins/tree-search";
const BUNDLE = ["main.js", "manifest.json", "styles.css"];

if (BUNDLE.some(f => !existsSync(join("dist", f)))) {
    console.error('run "bun run build" first');
    process.exit(1);
}

mkdirSync(DEST, { recursive: true });
// Keep .obsidian so Obsidian's own workspace.json survives between runs.
for (const entry of readdirSync(DEST)) {
    if (entry !== ".obsidian") rmSync(join(DEST, entry), { recursive: true, force: true });
}

// Reset persisted plugin state (Tree/Timeline modes, Quick Add draft) and the parse cache.
for (const f of ["data.json", "parse-cache.json"]) rmSync(join(PLUGIN, f), { force: true });

mkdirSync(PLUGIN, { recursive: true });
for (const f of BUNDLE) copyFileSync(join("dist", f), join(PLUGIN, f));

const now = new Date();
// {{date:N}} → local date of today + N days as YYYY-MM-DD (never UTC).
function expand(s: string): string {
    return s.replace(/\{\{date:(-?\d+)\}\}/g, (_, n) => {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + Number(n));
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
}

function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(p);
        else if (entry.isFile()) yield p;
    }
}

for (const file of walk(SRC)) {
    const out = join(DEST, expand(relative(SRC, file)));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, expand(readFileSync(file, "utf8")));
}

console.log(`vault ready: ${resolve(DEST)}`);
