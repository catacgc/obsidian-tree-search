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

/** A filter pill: `query` is toggled into/out of the search query (search-filter.ts). Names are unique (case-insensitive). */
export type SearchFilter = {name: string; query: string}
export const DEFAULT_SEARCH_FILTERS: SearchFilter[] = [{name: "Tasks", query: "is:task"}]
// Kept apart from settingsAtom for the same reason as searchViewModesAtom. Persisted to data.json by main.ts.
export const searchFiltersAtom = atom<SearchFilter[]>(DEFAULT_SEARCH_FILTERS)

// Shape of data.json.
export type PluginData = TreeSearchSettings & { searchViewModes?: SearchViewModes; quickAddDraft?: PersistedDraft; searchFilters?: SearchFilter[] }

export function updateSettings(store: GlobalStore, data: PluginData | null) {
	const { searchViewModes, quickAddDraft, searchFilters, ...settings } = data ?? {}
	store.set(settingsAtom, {...getSettings(store), ...settings})
	store.set(searchViewModesAtom, searchViewModes ?? {})
	store.set(appendDraftAtom, draftFromData(quickAddDraft))
	// Absent: never saved, so the default pills; [] means the user deleted them all. Names are rewritten to the
	// `:Name` reference charset (letters, digits, `_`, `-`; any other run becomes `-`), so a name saved with
	// spaces (`Recent tasks`) loads as `Recent-tasks` and can still be typed as a reference.
	store.set(searchFiltersAtom, (searchFilters ?? DEFAULT_SEARCH_FILTERS).map(f => ({...f, name: f.name.trim().replace(/[^\p{L}\p{N}_-]+/gu, "-")})))
}

export function getPluginData(store: GlobalStore): PluginData {
	return {...getSettings(store), searchViewModes: store.get(searchViewModesAtom), quickAddDraft: draftToData(store.get(appendDraftAtom)), searchFilters: store.get(searchFiltersAtom)}
}

export function getSettings(store: GlobalStore) {
	return store.get(settingsAtom)
}
