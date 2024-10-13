import {jest, describe, it, beforeEach, expect} from "@jest/globals";
import {useApp} from "../../src/view/react-context/AppContext";
import {NodeRenderer} from "../../src/view/NodeRenderer";
import {openFileByName} from "../../src/obsidian-utils";
import {render, screen, fireEvent} from '@testing-library/react';
import '@testing-library/jest-dom/jest-globals'
import {parseMarkdown} from "../../src/parser";
import React from "react";

// Mock the useApp hook
jest.mock('../../src/view/react-context/AppContext', () => ({
    useApp: jest.fn(),
}));

// Mock the openFileByName function
jest.mock('../../src/obsidian-utils', () => ({
    openFileByName: jest.fn(),
}));

function renderMarkdown(text: string) {
    const tokens = parseMarkdown(text, {})
    return render(<NodeRenderer tokens={tokens}/>)
}

describe('NodeRenderer', () => {
    const mockApp = {};

    beforeEach(() => {
        (useApp as jest.Mock).mockReturnValue(mockApp);
    });

    it('renders embeds', () => {
        renderMarkdown("![[Hello]]")

        expect(screen.getByText("![[Hello]]")).toBeInTheDocument();
    });

    it('renders snippets', () => {
        renderMarkdown("test `snippet`")

        expect(screen.getByText('snippet')).toBeInTheDocument();
    });

    it('renders inline tokens', () => {
        renderMarkdown("Hello");

        expect(screen.getByText('Hello')).toBeInTheDocument();
    });

    it('renders obsidian links and handles click', async () => {
        renderMarkdown("[[TestFile]]");

        const link = screen.getByText('TestFile');
        expect(link).toBeInTheDocument();

        fireEvent.click(link);

        expect(openFileByName).toHaveBeenCalledWith(mockApp, 'TestFile');
    });

    it('renders external links', () => {
        renderMarkdown("[Example](http://example.com)");

        const link = screen.getByText('Example');
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', 'http://example.com');
    });

    it('renders strong text', () => {
        renderMarkdown("**Bold**");

        expect(screen.getByText('Bold')).toBeInTheDocument();
    });

    it('renders emphasized text', () => {
        renderMarkdown("*Italic*");

        expect(screen.getByText('Italic')).toBeInTheDocument();
    });
});
