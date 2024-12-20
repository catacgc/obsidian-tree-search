import { atom, getDefaultStore } from "jotai";

export interface TreeSearchSettings {
	searchSeparator: string;
	parentRelation: string;
	archiveTag: string;
	socketPath: string;
}

export const settingsAtom = atom<TreeSearchSettings>({
	searchSeparator: ".", // better for mobile
	parentRelation: "parent",
	archiveTag: "archive",
	socketPath: "/tmp/raycast-{vaultname}.sock"
})

export function updateSettings(settings: TreeSearchSettings) {
	getDefaultStore().set(settingsAtom, {...getSettings(), ...settings})
}

export function getSettings() {
	return getDefaultStore().get(settingsAtom)
}
