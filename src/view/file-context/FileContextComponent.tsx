import {useCallback, useEffect, useState} from "react";
import {useApp} from "../react-context/AppContext";
import {TFile} from "obsidian";
import {openFileByName} from "../../obsidian-utils";
import { atom, useAtom, useAtomValue } from "jotai";
import { advancedSearch, flattenTasks, searchParents } from "src/search/search";
import { graphAtom, graphVersionAtom } from "../react-context/state";
import SearchPage from "../SearchPage";
import { separatorAtom } from "../react-context/settings";
import { getDefaultStore } from "jotai";

export const pinAtom = atom<boolean>(false)
export const activeFileAtom = atom<TFile>()

export const FileContextComponent = () => {
	const [activeFile, setActiveFile] = useAtom(activeFileAtom);
	const [pin, setPin] = useAtom(pinAtom);
	const app = useApp();

	const updateActiveFile = useCallback(() => {
		if (pin && activeFile) {
			return
		}

		const file = app.workspace.getActiveFile();
		file && setActiveFile(file);
	}, [pin, activeFile, app, setActiveFile]);

	useEffect(() => {
		if (!app) return

		// Get initial state without explicit call
		const file = app.workspace.getActiveFile();
		file && setActiveFile(file);

		// Set up event listener for future changes
		app.workspace.on('active-leaf-change', updateActiveFile);

		return () => {
			app.workspace.off('active-leaf-change', updateActiveFile);
		};
	}, [app, updateActiveFile]);

	async function openActiveFile() {
		if (app == undefined) return
		if (activeFile == undefined) return
		await openFileByName(app, activeFile.basename)
	}


	const graph = useAtomValue(graphAtom, {store: getDefaultStore()})
    const version = useAtomValue(graphVersionAtom)
    const separator = useAtomValue(separatorAtom)

	const searchParentsFn = useCallback((q: string) => {
        if (activeFile === undefined) {
            return []
        }

		return searchParents(graph.graph, activeFile)
    }, [graph, version, activeFile])

    const searchForActiveFile = useCallback((query: string) => {
        if (activeFile === undefined) {
            return []
        }

        const searchResults = advancedSearch(
            graph.graph, 
            `[[${activeFile.basename}]]`.toLowerCase(),
            query,
            separator
        )

        return searchResults;
    }, [graph, version, activeFile])

    const searchTasks = useCallback((query: string) => {
        if (activeFile === undefined) {
            return []
        }

        const searchResults = advancedSearch(
            graph.graph, 
            `[[${activeFile.basename}]]`.toLowerCase(),
            query,
            separator)

        return flattenTasks(searchResults).nodes
    }, [graph, version, activeFile])

	if (activeFile == undefined) return <></>

	return <>
			<SearchPage searchFn={searchParentsFn} sectionName="Parents"/>
			
			<SearchPage searchFn={searchForActiveFile} sectionName="" maxExpand={1}>
				<div className="flex items-center gap-2 mt-2 mb-2">
					<h4 className="m-0">
						<a href='#' onClick={ev => {openActiveFile(); ev.preventDefault() }}>{activeFile.basename}</a>
					</h4>
					{!pin && <button onClick={() => setPin(true)}>Pin</button>}
					{pin && <button onClick={() => setPin(false)}>Unpin</button>}
				</div>
			</SearchPage>
			<SearchPage searchFn={searchTasks} sectionName="Related Tasks" />
		</>
}
