import { useRef } from 'react';
import { App } from 'obsidian';
import {highlightLine, openFileByName} from '../../obsidian-utils';
import {ResultNode} from "../../search";
import { ParsedNode } from 'src/graph';

export const useUrlOpener = () => {
    const linkRef = useRef<HTMLAnchorElement>(null);

    const tryOpenUrl = async (app: App, attrs: ParsedNode) => {
        if (attrs.nodeType == "page") {
            await openFileByName(app, attrs.page);
            return;
        }
        if (attrs.nodeType == "header") {
            await openFileByName(app, attrs.page + "#" + attrs.header);
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
