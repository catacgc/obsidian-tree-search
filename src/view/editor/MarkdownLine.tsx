import React, { useEffect, useRef } from "react";
import { App, Component, MarkdownRenderer } from "obsidian";

export function MarkdownLine({ app, text, sourcePath }: { app: App; text: string; sourcePath: string }) {
    const ref = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const component = new Component();
        component.load();
        el.empty();
        MarkdownRenderer.render(app, text, el, sourcePath, component).catch(() => { /* best-effort render */ });
        return () => component.unload();
    }, [app, text, sourcePath]);

    return <span ref={ref} className="ts-pull-line" />;
}
