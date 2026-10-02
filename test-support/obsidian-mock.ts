/**
 * `bun test` preload: the "obsidian" package published to npm ships types
 * only (an empty `main` and no runtime entry point), so any file that uses
 * an obsidian export as a *value* (not just a type) throws
 * "Cannot find package 'obsidian'" the moment `bun test` tries to load it -
 * regardless of which function within that file is actually under test.
 *
 * This registers a minimal virtual "obsidian" module covering the handful
 * of obsidian exports that `src/obsidian-utils.ts` uses at the value level
 * (`normalizePath`, `FuzzySuggestModal`, `TFolder`), so files that import
 * them can be loaded under `bun test`. Types-only exports (`App`, `TFile`,
 * `FuzzyMatch`, etc.) are erased by the TS transpiler and never reach this
 * module, but are stubbed too in case a future usage makes them a real
 * value import.
 */
import { plugin } from "bun"

class TFolder {
    path = ""
    name = ""
    children: unknown[] = []
}

class TFile {
    path = ""
    name = ""
    basename = ""
    extension = ""
}

class FuzzySuggestModal<T> {
    app: unknown
    constructor(app: unknown) {
        this.app = app
    }
    open() {}
    close() {}
    setPlaceholder(_text: string) {}
    getItems(): T[] {
        return []
    }
    getItemText(_item: T): string {
        return ""
    }
    onChooseItem(_item: T, _evt: unknown) {}
}

function normalizePath(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "")
}

class App {}

const Platform = { isMobile: false, isTablet: false, isMacOS: true }

class Scope {
    constructor(_parent?: unknown) {}
    register() {
        return {}
    }
    unregister() {}
}

const moment = () => ({ format: (f: string) => f })

class Notice {
    constructor(_message: string) {}
}

plugin({
    name: "obsidian-mock",
    setup(builder) {
        builder.module("obsidian", () => ({
            exports: { App, TFile, TFolder, FuzzySuggestModal, normalizePath, Platform, Scope, moment, Notice },
            loader: "object",
        }))
    },
})
