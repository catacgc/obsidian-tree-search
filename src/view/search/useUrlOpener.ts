import { useRef } from 'react';
import { App } from 'obsidian';
import {highlightLine, openFileByName, revealFolder} from '../../obsidian-utils';
import { ParsedNode } from 'src/graph';

export const useUrlOpener = () => {
    const linkRef = useRef<HTMLAnchorElement>(null);

    const tryOpenUrl = async (app: App, attrs: ParsedNode) => {
        if (attrs.nodeType == "page") {
            await openFileByName(app, attrs.page);
            return;
        }
        if (attrs.nodeType == "header") {
            await highlightLine(app, attrs.location);
            return;
        }

        if (attrs.nodeType == "month") {
            // NOT HANDLED YET
            return
        }

        if (attrs.nodeType == "folder") {
            await revealFolder(app, attrs.path);
            return;
        }

        if (attrs.nodeType == "attachment") {
            await openFileByName(app, attrs.name);
            return;
        }

        if (attrs.nodeType == "folderNote") {
            await openFileByName(app, attrs.page.page);
            return;
        }

        if (attrs.nodeType == "pointer") {
            console.warn("Pointer node should not be opened directly");
            return;
        }

        const children = attrs.parsedTokens;

        for (const it of children) {
            let url = '';

            if (it.tokenType === 'obsidian_link') {
                if (it.headerName) {
                    await openFileByName(app, it.pageTarget + "#" + it.headerName);
                } else {
                    await openFileByName(app, it.pageTarget);
                }
                return;
            }

            if (it.tokenType === 'text' && it.text.trim().contains("http")) {
                url = extractFirstUrl(it.text);
            } else if (it.tokenType === 'link') {
                url = extractFirstUrl(it.href);
            }

            if (url && linkRef.current) {
                linkRef.current.href = url;
                linkRef.current.click();
                return;
            }
        }

        await highlightLine(app, attrs.location);
        return;
    };

    return { linkRef, tryOpenUrl };
};

function extractFirstUrl(text: string): string {
    const urlRegex = /(https?:\/\/[^\s)]+)/;
    const match = text.match(urlRegex);
    return match ? match[0] : '';
}
