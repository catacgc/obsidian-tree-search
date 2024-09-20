import { useContext } from "react";
import { AppContext } from "./treesearch";
import { App } from "obsidian";

export const useApp = (): App | undefined => {
  return useContext(AppContext);
};