# Highlight Search Matches in the Obsidian Plugin

## Problem

The search panel returns matching nodes but gives no visual indication of *why* a node matched. When a query like `"hello work"` returns dozens of results, the user has to manually scan each line to find the matching portion. This is especially painful with long text nodes or nodes that match via an ancestor (e.g. a child of a matching page).

Obsidian's own search view highlights matched terms inline. The plugin should do the same.

## Proposal

Derive a list of plain-text match terms from the active search query and pass them into the render tree. Each renderer that produces visible text splits its output around matched terms and wraps matches in `<mark class="suggestion-highlight">`, which is Obsidian's native highlight class — automatically styled by the active theme via `--text-highlight-bg-rgb`.

No changes to `@mdtree/core`. This is purely a plugin-layer concern.

## Scope

### What gets highlighted

| Node type | Highlighted text |
|-----------|-----------------|
| `text` node | plain-text token segments |
| `text` node | obsidian link display text (alias, or page target if no alias) |
| `page` node | page name (and aliases if shown) |
| `header` node | header string |

### What does NOT get highlighted

| Case | Reason |
|------|--------|
| External `link` tokens (`[label](url)`) | Links are navigational — highlighting inside them adds noise |
| `image` tokens | Not user-readable text |
| `meta_action` tokens | UI chrome, not search content |
| Negated terms (`-term`) | Excluded by design — user asked to exclude these |
| Query modifiers (`:task`, `:page`, …) | No text value to highlight |

### Term extraction

Given a query like `"hello work -exclude :task"`, the match terms are `["hello", "work"]`. Each term matches independently (not as a phrase). Matching is case-insensitive.

```
query: "hello work -exclude :task"
                │
         parseQuery() → QueryExpr
                │
         extractTerms()
                │
         ["hello", "work"]   ← only "contains" / "startsWith" / "equals" exprs
                               from non-negated branches
```

## Key Files

| File | Change |
|------|--------|
| `src/view/react-context/state.tsx` | Add `matchTermsAtom` to `SearchViewMolecule` |
| `src/view/NodeRenderer.tsx` | Accept `matchTerms` prop; highlight page/header names; pass to `TextNodeRenderer` |
| `src/view/SearchTreeNode.tsx` | Read `matchTermsAtom`, pass `matchTerms` to `NodeRenderer` |
| `src/view/SearchTreeNode.css` | Add `.suggestion-highlight` style using Obsidian's `--text-highlight-bg-rgb` |

## Success Criteria

- Searching `"work"` visually highlights the substring `work` inside every matched node's displayed text
- Multiple terms (`"hello work"`) each highlight independently
- Highlighting adapts to the active Obsidian theme (light/dark, custom accent)
- Negated terms and modifier-only queries produce no spurious highlights
- No visible regression in existing node rendering (links still navigate, tasks still show checkboxes)
