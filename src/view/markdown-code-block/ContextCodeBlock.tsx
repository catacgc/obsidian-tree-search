import {App, MarkdownPostProcessorContext, MarkdownRenderChild, parseYaml, TFile} from "obsidian";
import {createRoot} from "react-dom/client";
import {IndexedTree} from "../../indexed-tree";
import {GraphContextProvider} from "../react-context/GraphContextProvider";
import {InlineMarkdownResults} from "./InlineMarkdownResults";

export class MarkdownContextSettings {
    depth: number
    query: string
    file?: TFile
    heading?: string
    inferredFile: TFile
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
        let userProvidedFile = undefined

        const yaml = parseYaml(this.source);
        
        const yamlFile = yaml?.file
        if (yamlFile) {
            const justRef = yamlFile.replace("[[", "").replace("]]", "").split("|")[0]
            const fileAndHeading = justRef.split("#")
            const impliedRef = fileAndHeading[0]

            const found = this.app.vault.getFiles().find(it => it.basename == impliedRef)
            if (found) userProvidedFile = found;

            if (fileAndHeading.length > 1) {
                heading = fileAndHeading[1]
            }
        }


        const settings: MarkdownContextSettings = {
            depth: yaml?.depth == undefined ? 1 : yaml.depth,
            query: yaml?.query || "",
            file: userProvidedFile,
            heading: heading,
            inferredFile: inferredFile,
        }

        root.render(
            <GraphContextProvider app={this.app}>
                <InlineMarkdownResults settings={settings}/>
            </GraphContextProvider>
        );
    }

    async onunload() {
    }


}
