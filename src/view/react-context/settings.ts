import { atom } from "jotai";
import type { GlobalStore } from "./global";
import type { EditorState } from "../editor/EditorMolecule";
import { draftFromData, draftToData, type PersistedDraft } from "../editor/draft";

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
	socketPath: "/tmp/raycast-{vaultname}.sock",
})

export const separatorAtom = atom((get) => get(settingsAtom).searchSeparator)

export type SearchViewMode = "tree" | "timeline"
// Keyed by SearchViewScope name ("modal", "Search").
export type SearchViewModes = Record<string, SearchViewMode>

// Kept apart from settingsAtom: SettingsTab mutates the settings object in
// place, so replacing settingsAtom on toggle would orphan its edits.
export const searchViewModesAtom = atom<SearchViewModes>({})

// The editor's Append draft; kept until saved or discarded, persisted in data.json.
export const appendDraftAtom = atom<EditorState | null>(null)

// Shape of data.json.
export type PluginData = TreeSearchSettings & { searchViewModes?: SearchViewModes; quickAddDraft?: PersistedDraft }

export function updateSettings(store: GlobalStore, data: PluginData | null) {
	const { searchViewModes, quickAddDraft, ...settings } = data ?? {}
	store.set(settingsAtom, {...getSettings(store), ...settings})
	store.set(searchViewModesAtom, searchViewModes ?? {})
	store.set(appendDraftAtom, draftFromData(quickAddDraft))
}

export function getPluginData(store: GlobalStore): PluginData {
	return {...getSettings(store), searchViewModes: store.get(searchViewModesAtom), quickAddDraft: draftToData(store.get(appendDraftAtom))}
}

export function getSettings(store: GlobalStore) {
	return store.get(settingsAtom)
}
