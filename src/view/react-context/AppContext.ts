import {createContext, useContext} from "react";
import {App} from "obsidian";

// see https://github.com/DefinitelyTyped/DefinitelyTyped/pull/24509#issuecomment-1236350017
export const AppContext = createContext<App>(undefined as never);

export const useApp = (): App => {
  return useContext(AppContext);
};
