import {useCallback, useEffect, useState} from "react";
import {FileContextResults} from "./FileContextResults";
import {useApp} from "../react-context/AppContext";
import {TFile} from "obsidian";
import {openFileByName} from "../../obsidian-utils";
import { atom, useAtom } from "jotai";

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

	if (activeFile == undefined) return <></>

	return <>
			<h4><a href='#' onClick={ev => {openActiveFile(); ev.preventDefault() }}>{activeFile.basename}</a></h4>
			{!pin && <button onClick={() => setPin(true)}>Pin</button>}
			{pin && <button onClick={() => setPin(false)}>Unpin</button>}
			<FileContextResults/>
		</>
}
