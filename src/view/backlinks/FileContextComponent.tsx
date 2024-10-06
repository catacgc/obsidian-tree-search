import {useEffect, useState} from "react";
import {FileContextResults} from "./FileContextResults";
import {useApp} from "../react-context/AppContext";
import {TFile} from "obsidian";
import {openFileByName} from "../../obsidian-utils";
import {useGraph} from "../react-context/GraphContext";

type FileContextComponentProps = {
	query?: string
};

export const FileContextComponent = (props: FileContextComponentProps) => {
    const {graph, version} = useGraph();

	const [activeFile, setActiveFile] = useState<TFile | null>(null);
	const [pin, setPin] = useState<TFile>();
	const app = useApp();

	useEffect(() => {
		if (!app) return

		const updateActiveFile = () => {
			const file = app.workspace.getActiveFile();
			setActiveFile(file);
		};

		app.workspace.on('active-leaf-change', updateActiveFile);

		// Initial update
		updateActiveFile();

		// Cleanup listener on unmount
		return () => {
			app.workspace.off('active-leaf-change', updateActiveFile);
		};
	}, [app]);

	async function openActiveFile() {
		if (app == undefined) return
		if (activeFile == undefined) return
		await openFileByName(app, (pin || activeFile).basename)
	}



	return activeFile && <>
		<h4><a href='#' onClick={ev => {openActiveFile(); ev.preventDefault() }}>{(pin || activeFile).basename}</a></h4>
		<button onClick={() => setPin(pin ? undefined : activeFile)}>{pin ? `Unpin` : "Pin"}</button>

		<FileContextResults version={version} graph={graph} activeFile={pin || activeFile}/>
	</>
}
