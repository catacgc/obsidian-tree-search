import { MarkdownPostProcessorContext, MarkdownRenderChild, parseYaml, TFile } from "obsidian";
import { createRoot } from "react-dom/client";
import { GraphContextProvider } from "../react-context/GraphContextProvider";
import { InlineMarkdownResults } from "./InlineMarkdownResults";
import { getDefaultInjector } from "bunshi";
import { GlobalAppMolecule } from "../react-context/global";
import { getDefaultStore } from "jotai";

export class MarkdownContextSettings {
    depth: number
    query: string
    heading?: string
    basename: string
    inferred: boolean
    name?: string
}

export class MarkdownCodeBlock extends MarkdownRenderChild {
    constructor(private source: string,
        private context: MarkdownPostProcessorContext,
        element: HTMLElement,
        private store: ReturnType<typeof getDefaultStore>
    ) {
        super(element);
    }

    async onload() {
        this.containerEl.createEl("h1", { text: "" });
        const root = createRoot(this.containerEl);

        let app = this.store.get(getDefaultInjector().get(GlobalAppMolecule).appAtom);
        if (!app) return

        const findHeading = () => {
            const cache = app.metadataCache.getCache(this.context.sourcePath)

            if (!cache?.headings) return;

            const line = this.context.getSectionInfo(this.containerEl)?.lineStart || 0
            const headingIdx = cache.headings.findLastIndex(it => it.position.start.line <= (line || 0));

            if (headingIdx < 0) return;

            return cache.headings[headingIdx].heading;
        }

        let heading = findHeading();

        // this won't work for canvas files
        const inferredFile = app.vault.getAbstractFileByPath(this.context.sourcePath) as TFile
        let basename = inferredFile?.basename
        let inferred = true

        const yaml = parseYaml(this.source);
        const yamlFile = yaml?.file
        if (yamlFile) {
            const justRef = yamlFile.replace("[[", "").replace("]]", "").split("|")[0]
            const fileAndHeading = justRef.split("#")
            const impliedFile = fileAndHeading[0]
            const impliedHeading = fileAndHeading.length > 1 ? fileAndHeading[1] : undefined

            inferred = false
            basename = impliedFile
            heading = impliedHeading
        }

        const settings: MarkdownContextSettings = {
            depth: yaml?.depth == undefined ? 1 : yaml.depth,
            query: yaml?.query || "",
            basename: basename,
            heading: heading,
            inferred: inferred,
            name: yaml?.name || "",
        }

        // Define valid keys with their descriptions
        const validKeysWithDesc: Record<string, string> = {
            'file': 'Target file to analyze (in "[[file]]" or "[[file#header]]" format); defaults to CurrentFile#CurrentHeading',
            'query': 'Search query to filter results; optional, when set together with file, it will search within the file tree',
            'depth': 'Number of levels to display in the context tree; defaults to 1',
            'name': 'Custom name for the context block; optional'
        };
        const validKeys = Object.keys(validKeysWithDesc);
        const unexpectedKeys = yaml ? Object.keys(yaml).filter(key => !validKeys.includes(key)) : [];

        const noQueriableSource = !settings.basename && !settings.query
        const hasErrors = unexpectedKeys.length > 0 || noQueriableSource

        root.render(
            <GraphContextProvider store={this.store}>
                {hasErrors && (
                    <div className="context-block-warning">
                        {noQueriableSource && <p>Please provide a valid "file" or "query" setting</p>}
                        {unexpectedKeys.length > 0 && <p>Unknown settings found: {unexpectedKeys.join(', ')}</p>}
                        <p>Valid settings are:</p>
                        <ul>
                            {validKeys.map(key => (
                                <li key={key}><strong>{key}</strong>: {validKeysWithDesc[key]}</li>
                            ))}
                        </ul>
                    </div>
                )}
                {!hasErrors && <InlineMarkdownResults settings={settings} />}
            </GraphContextProvider>
        );
    }

    async onunload() {
    }


}
