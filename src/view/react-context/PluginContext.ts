import {createContext, useContext} from "react";

export interface TreeSearchSettings {
	searchSeparator: string;
	parentRelation: string;
	archiveTag: string;
	socketPath: string;
}

export class PluginContextContainer {
	settings: TreeSearchSettings

	constructor() {
		this.settings = {
			searchSeparator: ".", // better for mobile
			parentRelation: "parent",
			archiveTag: "archive",
			socketPath: "/tmp/raycast-{vaultname}.sock"
		}
	}
}

export const REACT_PLUGIN_CONTEXT = new PluginContextContainer()

const PluginContext = createContext<PluginContextContainer>(REACT_PLUGIN_CONTEXT);

export const useSettings = () => {
    return useContext(PluginContext).settings
}

