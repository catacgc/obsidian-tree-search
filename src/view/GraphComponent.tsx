import {useEffect, useState} from "react";
import {SearchView} from "./SearchView";
import {IndexedTree} from "../indexed-tree";

export const GraphComponent = (props: {index: IndexedTree}) => {
	const {index} = props;
	const [graph, setGraph] = useState(index.getState());
	const [version, setVersion] = useState(0);

	useEffect(() => {
		index.onChange((props) => {
			console.log("refreshing the graph: ", props)
			setGraph(props.graph)
			setVersion(props.version)
		})
	}, []);

	return <SearchView version={version} graph={graph} refresh={async () => await props.index.refresh()}/>
}
