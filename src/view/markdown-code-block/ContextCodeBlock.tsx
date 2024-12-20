import {App, MarkdownPostProcessorContext, MarkdownRenderChild, parseYaml, TFile} from "obsidian";
import {createRoot} from "react-dom/client";
import {IndexedTree} from "../../indexed-tree";
import {GraphContextProvider} from "../react-context/GraphContextProvider";
import {InlineMarkdownResults} from "./InlineMarkdownResults";

export class MarkdownContextSettings {
    depth: number
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
        let file = this.app.vault.getAbstractFileByPath(this.context.sourcePath) as TFile

        const yaml = parseYaml(this.source);
        const settings: MarkdownContextSettings = {
            depth: yaml?.depth == undefined ? 1 : yaml.depth
        }

        const yamlFile = yaml?.file
        if (yamlFile) {
            const justRef = yamlFile.replace("[[", "").replace("]]", "").split("|")[0]
            const fileAndHeading = justRef.split("#")
            const impliedRef = fileAndHeading[0]

            const found = this.app.vault.getFiles().find(it => it.basename == impliedRef)
            if (found) file = found;

            if (fileAndHeading.length > 1) {
                heading = fileAndHeading[1]
            }
        }

        root.render(
            <GraphContextProvider app={this.app}>
                <InlineMarkdownResults activeFile={file} heading={heading} settings={settings}/>
            </GraphContextProvider>
        );
    }

    async onunload() {
    }


}
