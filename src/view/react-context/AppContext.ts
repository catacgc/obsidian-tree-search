import {createContext, useContext} from "react";
import {App} from "obsidian";

export const AppContext = createContext<App | undefined>(undefined);

export const useApp = (): App | undefined => {
  return useContext(AppContext);
};
