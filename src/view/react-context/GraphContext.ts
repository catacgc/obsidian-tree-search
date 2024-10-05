import {createContext, useContext} from "react";
import {NotesGraph} from "../../graph";

type GraphContextProperties = {
	graph: NotesGraph;
	version: number;
}

export const GraphContext = createContext<GraphContextProperties>({
	graph: new NotesGraph(),
	version: 0
});

export const useGraph  = (): GraphContextProperties => {
	return useContext(GraphContext);
};
