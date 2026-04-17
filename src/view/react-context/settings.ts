import { atom, getDefaultStore } from "jotai";

export interface TreeSearchSettings {
	searchSeparator: string;
	parentRelation: string;
	archiveTag: string;
}

export const settingsAtom = atom<TreeSearchSettings>({
	searchSeparator: ".", // better for mobile
	parentRelation: "parent",
	archiveTag: "archive",
})

export const separatorAtom = atom((get) => get(settingsAtom).searchSeparator)

export function updateSettings(store: ReturnType<typeof getDefaultStore>, settings: TreeSearchSettings) {
	store.set(settingsAtom, {...getSettings(store), ...settings})
}

export function getSettings(store: ReturnType<typeof getDefaultStore>) {
	return store.get(settingsAtom)
}
