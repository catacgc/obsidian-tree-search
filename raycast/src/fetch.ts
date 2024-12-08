import axios from "axios";
import { it } from "node:test";
import { IndexedResult } from "obsidian-tree-search/src/search";

export interface VaultResults {
  vault: string;
  results: IndexedResult;
}

export async function fetchData(query: string, socketPath:string): Promise<{ data: IndexedResult }> {
  const http = axios.create({
    socketPath: socketPath,
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

function extractVaultName(path: string): string {
  // /tmp/raycast-Obsidian Vault.sock
  return path.replace("/tmp/raycast-", "").replace(".sock", "");
}

export async function searchBookmarks(
  query: string,
  preferences: Preferences,
): Promise<VaultResults[]> {
  
  const vaults = preferences.socketPath.split(",").map(
    it => {
      return {
        socket: it.trim(),
        vault: extractVaultName(it)
      }
    }
  );

  const promises = vaults.map(it => getVaultResults(query, it)); 
  const results = await Promise.all(promises);
  return results;
}

async function getVaultResults(query: string, it: { socket: string; vault: string}): Promise<VaultResults> {
  const data = await fetchData(query, it.socket);
  return {
    vault: it.vault,
    results: data.data
  }
}

