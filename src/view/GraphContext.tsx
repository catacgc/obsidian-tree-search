import {createContext, useContext} from "react";
import {NotesGraph} from "../graph";

export const GraphContext = createContext(new NotesGraph());
export const useGraph = () => useContext(GraphContext);
