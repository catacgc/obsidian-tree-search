import {NodeAttributes} from "./graph";

type QueryModifier = ':task' | ':emoji' | ':page' | ':header';

export type QueryExpr = 
    | { type: 'contains'; value: string }
	| { type: 'empty' }
    | { type: 'equals'; value: string }
    | { type: 'startsWith'; value: string }
    | { type: 'not'; expr: QueryExpr }
    | { type: 'and'; exprs: QueryExpr[] }
    | { type: 'or'; exprs: QueryExpr[] }
    | { type: 'modifier'; value: QueryModifier };

function tokenize(query: string): string[] {
    return query.trim()
        .split(/\s+/)
        .filter(token => token.length > 0);
}

export function parseQuery(query: string): QueryExpr {
    if (!query.trim()) {
        return { type: 'empty' };
    }

    const tokens = tokenize(query);
    return parseOrGroups(tokens);
}

function parseOrGroups(tokens: string[]): QueryExpr {
    const groups = splitByOr(tokens);
    
    if (groups.length === 1) {
        return parseAndGroup(groups[0]);
    }

    return {
        type: 'or',
        exprs: groups.map(group => parseAndGroup(group))
    };
}

function parseAndGroup(tokens: string[]): QueryExpr {
    if (tokens.length === 1) {
        return parseToken(tokens[0]);
    }

    return {
        type: 'and',
        exprs: tokens.map(token => parseToken(token))
    };
}

function splitByOr(tokens: string[]): string[][] {
    const groups: string[][] = [];
    let currentGroup: string[] = [];

    for (const token of tokens) {
        if (token === '|') {
            if (currentGroup.length > 0) {
                groups.push(currentGroup);
                currentGroup = [];
            }
        } else {
            currentGroup.push(token);
        }
    }

    if (currentGroup.length > 0) {
        groups.push(currentGroup);
    }

    return groups;
}

function parseToken(token: string): QueryExpr {
    // Handle modifiers
    if (token.startsWith(':')) {
        const modifier = token as QueryModifier;
        if ([':task', ':emoji', ':page', ':header'].includes(modifier)) {
            return { type: 'modifier', value: modifier };
        }
    }

    // Handle exact match
    if (token.startsWith('"') && token.endsWith('"')) {
        return { type: 'equals', value: token.slice(1, -1) };
    }

    // Handle starts with
    if (token.startsWith('"')) {
        return { type: 'startsWith', value: token.slice(1) };
    }

    // Handle negation
    if (token.startsWith('-')) {
        return { type: 'not', expr: { type: 'contains', value: token.slice(1) } };
    }

    // Default to contains
    return { type: 'contains', value: token };
}

export function matchExpr(attrs: NodeAttributes, expr: QueryExpr): boolean {
    switch (expr.type) {
		case 'empty':
			return true;
        case 'contains':
            return attrs.searchKey.toLowerCase().includes(expr.value.toLowerCase());
        case 'equals':
            return attrs.searchKey.toLowerCase() === expr.value.toLowerCase();
        case 'startsWith':
            return attrs.searchKey.toLowerCase().startsWith(expr.value.toLowerCase());
        case 'not':
            return !matchExpr(attrs, expr.expr);
        case 'and':
            return expr.exprs.every(e => matchExpr(attrs, e));
        case 'or':
            return expr.exprs.some(e => matchExpr(attrs, e));
        case 'modifier':
            switch (expr.value) {
                case ':task':
                    return attrs.nodeType === 'task';
                case ':emoji':
                    return containsEmoji(attrs.searchKey);
                case ':page':
                    return attrs.nodeType === 'page' || attrs.nodeType === 'virtual-page';
                case ':header':
                    return attrs.nodeType === 'header';
            }
    }
}

const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
export function containsEmoji(text: string): boolean {
    return emojiRegex.test(text);
}

export function firstPassInclude(attrs: NodeAttributes, expr: QueryExpr) {
	if (expr.type == "not") {
		return !matchExpr(attrs, expr.expr)
	}

	return matchExpr(attrs, expr)
}

export function matchQuery(attrs: NodeAttributes, expr: QueryExpr): boolean {
    return matchExpr(attrs, expr);
}
