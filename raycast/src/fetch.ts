import axios from "axios";
import { IndexedResult } from "obsidian-tree-search/src/search";

export async function fetchData(query: string, preferences: Preferences) {
  const http = axios.create({
    socketPath: preferences.socketPath,
    baseURL: `http://localhost`,
    timeout: 20000,
  });

  return await http({
    method: "GET",
    url: "/?query=" + query,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function searchBookmarks(
  query: string,
  preferences: Preferences,
): Promise<{ data: IndexedResult }> {
  return fetchData(query, preferences);
}
