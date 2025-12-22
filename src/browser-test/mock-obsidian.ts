/**
 * Mock Obsidian module for browser testing.
 * Provides stub implementations of Obsidian API classes and functions
 * that are referenced by the components.
 */

export class Platform {
    static isMobile = false;
    static isTablet = false;
    static isDesktopApp = false;
    static isMacOS = false;
    static isMobileApp = false;
}

export class Notice {
    constructor(message: string, timeout?: number) {
        console.log('[Notice]', message);
    }
}

export class Modal {
    app: any;
    modalEl: HTMLElement;
    contentEl: HTMLElement;
    containerEl: HTMLElement;

    constructor(app: any) {
        this.app = app;
        this.modalEl = document.createElement('div');
        this.contentEl = document.createElement('div');
        this.containerEl = document.createElement('div');
    }

    open() { }
    close() { }
}

export class TFile {
    path: string = '';
    name: string = '';
    basename: string = '';
    extension: string = '';
}

export class TFolder {
    path: string = '';
    name: string = '';
}

export interface FuzzyMatch<T> {
    item: T;
    match: {
        score: number;
        matches: number[][];
    };
}

export class App {
    vault: any;
    workspace: any;
    metadataCache: any;
    fileManager: any;
}

export class FuzzySuggestModal<T> extends Modal {
    constructor(app: any) {
        super(app);
    }
    getSuggestions(query: string): T[] {
        return [];
    }
    renderSuggestion(item: T, el: HTMLElement) { }
    onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent) { }
}

export class SuggestModal<T> extends Modal {
    constructor(app: any) {
        super(app);
    }
    getSuggestions(query: string): T[] {
        return [];
    }
    renderSuggestion(value: T, el: HTMLElement) { }
    onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent) { }
}

// Add any other Obsidian exports that might be needed
export const normalizePath = (path: string) => path;
export const setIcon = (el: HTMLElement, icon: string) => { };
export const prepareQuery = (query: string) => ({ query, fuzzy: [] });
export const fuzzySearch = (query: any, text: string) => null;
