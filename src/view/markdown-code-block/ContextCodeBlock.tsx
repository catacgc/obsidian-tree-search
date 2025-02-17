import {App, MarkdownPostProcessorContext, MarkdownRenderChild, parseYaml, TFile} from "obsidian";
import {createRoot} from "react-dom/client";
import {IndexedTree} from "../../indexed-tree";
import {GraphContextProvider} from "../react-context/GraphContextProvider";
import {InlineMarkdownResults} from "./InlineMarkdownResults";

export class MarkdownContextSettings {
    depth: number
    query: string
    heading?: string
    basename: string
    inferred: boolean
    name?: string
}

export class ContextCodeBlock extends MarkdownRenderChild {
    constructor(private source: string,
                private context: MarkdownPostProcessorContext,
                element: HTMLElement,
                private index: IndexedTree,
                private app: App
    ) {
        super(element);
    }

    async onload() {
        this.containerEl.createEl("h1", {text: ""});
        const root = createRoot(this.containerEl);

        const cache = this.app.metadataCache.getCache(this.context.sourcePath)
        if (!cache) {
            return
        }

        const findHeading = () => {
            if (!cache?.headings) return;

            const line = this.context.getSectionInfo(this.containerEl)?.lineStart || 0
            const headingIdx = cache.headings.findLastIndex(it => it.position.start.line <= (line || 0));

            if (headingIdx < 0) return;

            return cache.headings[headingIdx].heading;
        }

        let heading = findHeading();
        const inferredFile = this.app.vault.getAbstractFileByPath(this.context.sourcePath) as TFile
        let basename = inferredFile.basename
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
            'depth': 'Number of levels to display in the context tree; defaults to 1',
            'query': 'Search query to filter results; optional, when set together with file, it will search within the file tree',
            'file': 'Target file to analyze (in "[[file]]" or "[[file#header]]" format); defaults to CurrentFile#CurrentHeading',
            'name': 'Custom name for the context block; optional'
        };
        const validKeys = Object.keys(validKeysWithDesc);
        const unexpectedKeys = yaml ? Object.keys(yaml).filter(key => !validKeys.includes(key)) : [];

        root.render(
            <GraphContextProvider app={this.app}>
                {unexpectedKeys.length > 0 && (
                    <div className="context-block-warning">
                        <p>Unknown settings found: {unexpectedKeys.join(', ')}</p>
                        <p>Valid settings are:</p>
                        <ul>
                            {validKeys.map(key => (
                                <li key={key}><strong>{key}</strong>: {validKeysWithDesc[key]}</li>
                            ))}
                        </ul>
                    </div>
                )}
                <InlineMarkdownResults settings={settings}/>
            </GraphContextProvider>
        );
    }

    async onunload() {
    }


}
