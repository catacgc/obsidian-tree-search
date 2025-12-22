import { App } from 'obsidian';

/**
 * Mock implementation of Obsidian's App interface for browser testing.
 * Only implements the minimal required properties to satisfy TypeScript
 * and allow React components to run without errors.
 */
export function createMockApp(): App {
    const mockApp = {
        vault: {
            getName: () => 'browser-test-vault',
            getAbstractFileByPath: (path: string) => {
                console.warn('[MockApp] getAbstractFileByPath called with:', path);
                return null;
            },
            getFileByPath: (path: string) => {
                console.warn('[MockApp] getFileByPath called with:', path);
                return null;
            },
            getFolderByPath: (path: string) => {
                console.warn('[MockApp] getFolderByPath called with:', path);
                return null;
            },
            getRoot: () => {
                console.warn('[MockApp] getRoot called');
                return {
                    path: '/',
                    name: '',
                    children: []
                };
            },
            adapter: {
                exists: async (path: string) => {
                    console.warn('[MockApp] adapter.exists called with:', path);
                    return false;
                }
            }
        },
        workspace: {
            getActiveFile: () => {
                console.warn('[MockApp] getActiveFile called');
                return null;
            },
            getActiveViewOfType: (type: any) => {
                console.warn('[MockApp] getActiveViewOfType called with:', type);
                return null;
            },
            getLeavesOfType: (type: string) => {
                console.warn('[MockApp] getLeavesOfType called with:', type);
                return [];
            },
            getLeaf: (newLeaf?: boolean) => {
                console.warn('[MockApp] getLeaf called with newLeaf:', newLeaf);
                return null;
            },
            openLinkText: async (linktext: string, sourcePath: string, newLeaf?: boolean) => {
                console.warn('[MockApp] openLinkText called with:', linktext, sourcePath);
            },
            activeLeaf: null,
            on: (event: string, callback: any) => {
                console.warn('[MockApp] workspace.on called with event:', event);
                return { unload: () => { } };
            },
            off: (event: string, callback: any) => {
                console.warn('[MockApp] workspace.off called with event:', event);
            }
        },
        metadataCache: {
            getFileCache: (file: any) => {
                console.warn('[MockApp] getFileCache called');
                return null;
            },
            on: (event: string, callback: any) => {
                console.warn('[MockApp] metadataCache.on called with event:', event);
                return { unload: () => { } };
            }
        },
        fileManager: {
            processFrontMatter: async (file: any, fn: any) => {
                console.warn('[MockApp] processFrontMatter called');
            }
        }
    } as unknown as App;

    return mockApp;
}
