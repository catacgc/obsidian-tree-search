import { useRef } from 'react';
import { App } from 'obsidian';
import { openFileByName } from '../../obsidian-utils';
import {ResultNode} from "../../search";

export const useUrlOpener = () => {
    const linkRef = useRef<HTMLAnchorElement>(null);

    const tryOpenUrl = async (app: App, node: ResultNode) => {
        const children = node.attrs.tokens[0]?.children;
        if (!children || !linkRef.current) return;

        for (const it of children) {
            let url = '';
            if (it.type === 'text') {
                url = extractFirstUrl(it.content);
            } else if (it.type === 'link_open') {
                url = extractFirstUrl(it.attrs?.[0]?.[1] || '');
            } else if (it.type === 'obsidian_link') {
                await openFileByName(app, it.content.split('|')[0].split('#')[0]);
                break;
            }

            if (url) {
                linkRef.current.href = url;
                linkRef.current.click();
                break;
            }
        }
    };

    return { linkRef, tryOpenUrl };
};

function extractFirstUrl(text: string): string {
    const urlRegex = /(https?:\/\/[^\s)]+)/;
    const match = text.match(urlRegex);
    return match ? match[0] : '';
}
