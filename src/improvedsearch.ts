import {ResultNode} from "./search";
import {attr} from "svelte/internal";
import {NodeAttributes} from "./graph";

type GraphQuery = {
    queries: QueryComponent
}

type QueryComponent = MatchString | ExcludeString | ExactFileMatch

type MatchString = { type: "match", words: string[] }
type ExcludeString = { type: "exclude", value: string }
type ExactFileMatch = { type: "file", value: string }

/**
 * Parse Queries with the following examples (. is the separator):
 * - "a b" -> [{ type: "match", "words": ["a","b"]} ]
 * - "parent . child" -> [{ type: "match", "words": ["parent"] }, { type: "match", "words": ["child"] }]
 * - "file:'A' . child" -> [{ type: "file", "value": "A" }, { type: "match", "words": ["child"] }]
 * -> "a -b" -> [{ type: "match", "words": ["a"] }, { type: "exclude", "value": "b" }]
 */
export function getQueryComponents(query: string, separator = "."): QueryComponent[] {
    const components = query.split(separator).map(it => it.trim());
    const result: QueryComponent[] = [];

    for (const component of components) {
        if (component.startsWith("file:")) {
            result.push({ type: "file", value: component.substring(5).toLowerCase() });
        } else if (component.startsWith("-")) {
            result.push({ type: "exclude", value: component.substring(1).toLowerCase() });
        } else {
            result.push({ type: "match", words: component.toLowerCase().split(" ") });
        }
    }

    return result;
}

export function matchNodeAttribute(key: string, attrs: NodeAttributes, query: QueryComponent): boolean {
    if (query.type === "match") {
        return query.words.every(word => attrs.searchKey.includes(word));
    } else if (query.type === "exclude") {
        return !attrs.searchKey.includes(query.value);
    } else {
        return attrs.location.path.contains(query.value);
    }
}
