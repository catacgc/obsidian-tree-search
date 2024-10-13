import {NodeAttributes} from "./graph";

export type SearchExpr = {
	operator: "and" | "or" | "not" | "value",
	children: SearchExpr[],
	value: string
};

function matchesExpr(attrs: NodeAttributes, expr: SearchExpr): boolean {
	if (expr.operator === "and") {
		return expr.children.every(c => matchesExpr(attrs, c));
	} else if (expr.operator === "or") {
		return expr.children.some(c => matchesExpr(attrs, c));
	} else if (expr.operator === "not") {
		return !matchesExpr(attrs, expr.children[0]);
	} else {
		return matchNode(attrs, expr);
	}
}


function matchNode(attrs: NodeAttributes, expr: SearchExpr) {
    if (expr.operator === "value" && expr.value.startsWith(":")) {
        if (expr.value == ":task" && attrs.nodeType == "task") {
            return true
        }

        if (expr.value == ":page" && (attrs.nodeType == "page" || attrs.nodeType == "virtual-page")) {
            return true
        }

        if (expr.value == ":header" && (attrs.nodeType == "header")) {
            return true
        }
    }

    return attrs.searchKey.includes(expr.value)
}

export function parseQuery(query: string): SearchExpr {
	const words = query.toLowerCase().split(" ")
		.map(it => it.trim())
		.filter(it => it.length > 0);
	const stack: SearchExpr[] = [];

	for (const word of words) {
		if (word === "and") {
			stack.push({ operator: "and", children: [], value: "" });
		} else if (word === "or") {
			stack.push({ operator: "or", children: [], value: "" });
		} else if (word.startsWith("-")) {
			stack.push({ operator: "not", children: [{ operator: "value", children: [], value: word.substring(1) }], value: "" });
		} else {
			stack.push({ operator: "value", children: [], value: word });
		}
	}

	const root: SearchExpr = { operator: "and", children: [], value: "" };
	let current: SearchExpr = root;

	for (const node of stack) {
		if (node.operator === "and" || node.operator === "or") {
			const newNode: SearchExpr = { operator: node.operator, children: [], value: "" };
			current.children.push(newNode);
			current = newNode;
		} else {
			current.children.push(node);
		}
	}

	return root;
}

export function matchQuery(attr: NodeAttributes, searchExpr: SearchExpr): boolean {
	return matchesExpr(attr, searchExpr);
}
