# Quick Add as chip-less patch mode

Approved 2026-10-09.

## Behavior

- The **Quick Add** and **Open editor** commands open the Search modal (opening it if needed) in *chip-less patch mode*: an empty input and an append chain with no chips. **Alt+N** (Open editor / the panel's View item, now titled **Quick Add**) starts the same mode in the current Search view (modal or pane).
- With no chip, the results are the normal search for the typed text. Entry syntax (`- x`, `[ ] task`, `[[`, `|`, `#`, `(k:: v)`) shows the chain's own results, as in any append chain.
- **Enter:**
  - On a selected page, header or line, the footer reads **Patch &lt;row&gt;**, and Enter makes that row the anchor chip (`chainPatchRowAtom` → `pushChainAtom`). The existing patch flow continues from there.
  - When the text matches nothing (or is entry syntax), the footer reads **Add**, and Enter writes it into today's daily note (`chainOutline` with no anchor). Open tasks get `[scheduled:: today]`. The input clears and the mode stays chip-less for the next add.
  - With chips, the footer reads **Patch**, as before.
- **Title:** `Quick Add` until a row chip exists, then `Patch <chip>`. **Placeholder:** `Search to patch, or type to add to today`.
- **Leaving:** Backspace on the first chip returns to chip-less mode. Escape leaves patch mode and restores the query from before it; a second Escape closes the modal.
- **Alt+Enter:** on an empty input with no entries, it shows the saved Append draft. With text or entries, it opens the editor on the chain, as now.

## Model

- `AppendChain` gains `quickAdd?: {prevQuery: string}`: the chain started chip-less. `steps` may then be empty; without it, `steps[0]` is a row step as before.
- `chainPrevQuery(chain)`: the query to restore on leaving.
- `chainReplacesSearch(chain, query)`: false for a chip-less chain with no steps and non-entry input, so the view runs its normal search.
- A view-request atom `GlobalAtoms.quickAddRequestAtom: {view} | null`, consumed by the view's SearchBar, starts the mode (`startQuickAddAtom`).

## Removed

The separate Quick Add modal host becomes unreachable and is deleted: the `quickAdd` SearchModal kind, `QuickAddView`, `openQuickAddAtom`, `leaveQuickAddAtom`, `quickAddClosedAtom`, `QuickAddExit`, `quickAddExitAtom`, `modalsAtom`, and every `isQuickAdd` branch. The Append draft and its `quickAddDraft` persistence stay.
