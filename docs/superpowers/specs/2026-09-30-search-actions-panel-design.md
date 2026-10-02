# Search actions: footer bar and action panel

Date: 2026-09-30 · Status: **implemented** (desktop live-checked; mobile long-press not yet checked on a device)

## Problem

The search views put every control in one row next to the input, plus a row of text buttons under it:

- **Search row** (`src/view/search/SearchBar.tsx:128-162`): a Search icon whose `onClick` does nothing, Clear, `−` / depth / `+`, the Open editor pencil, Tree/Timeline and Refresh. The icon buttons are 17–24 px wide.
- **Action bar** (`src/view/search/SearchActions.tsx`): the selected row's actions as text buttons at least 80 px wide. In a 490 px sidebar they truncate to "Brows… Open … See in… Copy … In…" and scroll sideways.
- **Mobile:**
  - Append shows an always-visible ⊕ at every group end (`mobileAppendDots`).
  - Edit is a hidden 500 ms long-press (`src/view/editor/row-editing-hooks.ts`).
  - Drag-to-reparent is disabled and nothing replaces it.
  - Tooltips and keyboard shortcuts can't be discovered on touch.

## Decision

Use the Raycast pattern on every platform:

- a **footer bar** under the results that shows the selected row, its main action and an **Actions** entry;
- an **action panel** that opens above the footer and lists every action for the selected row and the view.

Desktop opens the panel with **⌘K** (Ctrl+K elsewhere) or by clicking **Actions**. Mobile opens it by tapping **Actions** or by long-pressing a row. The search row keeps only the input, Clear and the Tree/Timeline switch.

```
┌ [ query…                              × ]   [Tree|Timeline]
│   [All 7d 30d 1y]                               (Timeline mode only)
├ results            tap/click selects · tap/click the selected row again = See in Obsidian
│                    long-press (mobile) = select + open panel
└ footer:  ▸ selected row      Open ↵  │  Actions ⌘K
           panel above the footer: sections Selected row · Edit · View, filter field at the bottom
```

Alternatives considered:

- **Obsidian `Menu` for the row actions.** It has no filter field and no column for shortcut labels, and it can't be anchored to the footer. It was rejected so that desktop and mobile share one component.
- **Buttons in the view header via `ItemView.addAction`.** The pane hides its view header and the modal has none. Rejected.
- **A collapsed "add" row above the search box.** Dropped. Open editor is a panel item, next to the existing Alt+N shortcut and the `tree-search:open-editor` command.

## Scope

- **Where the footer appears:** it replaces `SearchActions` wherever that renders today, which is every `SearchViewFlatten` with `viewState.showSearch`: the Search pane, the Search modal, Quick Link and the auxiliary panes.
- **Where the panel sections appear:**
  - Edit items only where `allowEditing` is set.
  - View items only where they apply: Tree-only items are hidden in Timeline mode.
- **Unchanged:**
  - every keyboard shortcut in `SHORTCUTS`;
  - desktop hover ⊕, Alt+click / Alt+Enter edit, and drag-to-reparent;
  - the inline editor;
  - the Raycast socket (`getTreeNodeActions` stays its source of actions);
  - the `tree-search:open-editor` command.

## 1. Search row (`SearchBar.tsx`)

- **Keep:** the input, Clear (`×`) and the Tree/Timeline switch (`allowTimeline` only). The Timeline recency chips (`TimelineFilterBar`) stay under the input in Timeline mode.
- **Remove:** the do-nothing Search icon, `−` / depth / `+`, the Open editor pencil (`SquarePen`) and Refresh. Their actions move to the panel (§3).
- Shrink the input's right padding (`pr-16`) to fit the single Clear decorator.

## 2. Footer bar (`src/view/search/ActionFooter.tsx`, new; replaces `SearchActions.tsx`)

- **Placement:** after the scrolling results container in `SearchViewFlatten`, outside it. The dock (`.ts-action-dock`, footer + panel) is `position: sticky; bottom: 0`: in the Search pane the whole leaf scrolls, so the footer pins to the visible bottom (the pane's `.view-content` bottom padding is removed so it sits flush); in the modal the results scroll on their own.
- **Content, left to right:**
  1. The selected row's title, a single line, middle-truncated with the existing `truncateMiddle` (moved from `SearchActions.tsx`).
  2. The **main action**: its title and a `↵` keycap. It is the action `handleDefaultActionAtom` runs, meaning the one whose `shortcut.key === "enter"`. The item is hidden when the row has no such action.
  3. A divider, then **Actions** with keycaps `⌘` `K` (`Ctrl` `K` off macOS).
- **No row selected:** only **Actions** shows. The panel then lists only the View section.
- **Clicks:** the main action runs it (`executeActionAtom`). **Actions** toggles the panel.
- **Keycaps:** `<kbd class="ts-keycap">` with a 1 px `--background-modifier-border` border, `--radius-s` corners and `--font-ui-smaller` text. They are hidden when `Platform.isMobile`.
- **Style:** the search block's look: `--color-base-00` background, a 1 px `--background-modifier-border` top border, muted text (`--color-base-40`), and the accent color on hover. Height 32 px on desktop and 44 px on `Platform.isPhone`.

## 3. Action panel (`src/view/search/ActionPanel.tsx` + pure `src/view/search/action-panel.ts`, new)

### 3.1 Items

`action-panel.ts` exports a pure builder:

```ts
export type PanelItem = {
    id: string                                  // ShortcutId, or `link:<n>` for a row's link action
    section: "row" | "edit" | "view"
    title: string
    key?: KeySpec                               // shown as keycaps: the first key of the matching SHORTCUTS entry
    run: PanelRun                               // {kind: "shortcut", id: ShortcutId} | {kind: "action", action: RaycastAction} | {kind: "moveUnder"}
}
export function panelItems(ctx: {
    rowActions: RaycastAction[]                 // selectedTreeNodeActionsAtom; [] when nothing is selected
    rows: TreeNode[]; selectedPos: number       // -1 when nothing is selected
    allowEditing: boolean; allowTimeline: boolean; timelineActive: boolean; isQuickLink: boolean
    ownPath: OwnPath
}): PanelItem[]
```

**Selected row section.** Header: the row title. The items are `rowActions` in order, each run through `executeActionAtom`, with these exceptions:

- The main action gets the `↵` keycap.
- An action that maps to a `SHORTCUTS` id shows that id's keys:

  | Action | Keys |
  |---|---|
  | See in Obsidian | `reveal` ⇧↵ |
  | Copy | `copy` ⌃C |
  | `insert` | `insertAfter` ⌥I |
  | `moveToFolder` | `moveTo` ⌥M |
  | archive / unarchive | `archive` ⌥X |
  | `pullChildren` | `consolidate` ⌥P |

  Mapping uses `raycastActionOf` and `action.type`, the same test as `KeyComboWrapper`'s handlers.
- Where `allowEditing` is set, the `insert` action is **left out**. `executeActionAtom` already turns it into Append, which would duplicate **Append to**.

**Edit section** (`allowEditing` and a selected row):

- **Append to [[P]]** (⌥A): shown when `appendTargetAt(rows, pos, timelineActive)` is non-null. `P` is that target's `parentName`. Runs the `append` shortcut.
- **Edit line** (⌥↵): shown when `isEditableRow(row, ownPath, timelineActive)`. Runs `edit`.
- **Move under…**: Tree mode only, shown when `dragInfo(rows, pos).draggable`. It opens the sub-list in §3.3.

**View section** (always present):

- **Open editor** (⌥N), when `allowEditing`.
- **Show timeline** / **Show tree** (⌥T), when `allowTimeline`.
- **Expand one level** (⌥=), **Collapse one level** (⌥-) and **Collapse all** (⌥0), Tree mode only.
- **Rebuild index** (⌥R).

Navigation (`next`, `previous`) and `recency` are not listed; the chips stay visible.

**Filter:** case-insensitive substring match on `title`. Sections with no matching items are hidden.

### 3.2 One dispatch path

- Move the `handlers: Record<ShortcutId, …>` table out of `KeyComboWrapper` into a hook, `useShortcutHandlers()` in `src/view/search/shortcut-handlers.ts`.
- `KeyComboWrapper` and `ActionPanel` both call it. A panel item runs `handlers[id](0)`, or `executeActionAtom(action)`, or opens §3.3.
- Running any item closes the panel and returns focus to the search input, except the items that open the inline editor (**Append to**, **Edit line**, **Open editor**), which leave focus in the editor. Choosing a Move under target also returns focus to the search.

### 3.3 Move under… (sub-list)

- **Opening:** choosing **Move under…** replaces the panel's items with a flat list of candidate pages. The header reads `Move <row title> under…` and has a back chevron.
- **Candidates:** every row position `t` with `isValidDropTarget(rows, pos, t)`, in result order. This is the same rule drag uses, so the choice is limited to pages visible in the current results. Each candidate shows the page title.
- **Choosing:** `reparentAtom(pos, t)`, the same write path as a drop.
- **Filter and keys:** the filter applies to the candidate titles. Esc or the back chevron returns to the main list.

### 3.4 Look and placement

- **Placement:** rendered inside the view, above the footer and aligned to its right edge. Width `min(360px, 100% - 16px)`. On `Platform.isPhone`, or when the view is narrower than 400 px, it spans the full width.
- **Size:** max height 60 % of the view; the list scrolls.
- **Style:** `--color-base-00` background, a 1 px `--background-modifier-border` border, `--radius-m` corners and `--shadow-s`.
- **Sections:** a muted, small section title; sections are separated by a 1 px divider.
- **Rows:** 32 px tall (44 px on `Platform.isPhone`), with a 16 px lucide icon, the title, and right-aligned keycaps (hidden on mobile). The highlighted row uses `--background-modifier-hover`. The first row is highlighted on open.
- **Filter field:** at the bottom, placeholder `Search for actions…` (`Search for a note…` in Move under). It is an `<input type="text">`: the panel only exists while open and renders after the search input, so it never becomes the "first input" the modal and `activateView` focus.
- **Icons** (lucide):
  - Selected row: `ExternalLink` for link actions, `FileSearch` See in Obsidian, `Copy`, `CornerDownRight` Insert after, `FolderInput` Move to folder, `Archive`, `Combine` Consolidate.
  - Edit: `CirclePlus` Append to, `Pencil` Edit line, `ArrowRightLeft` Move under.
  - View: `SquarePen` Open editor, `ListTree` / `CalendarClock` Tree/Timeline, `ChevronsUpDown` / `ChevronsDownUp` Expand/Collapse, `RefreshCw` Rebuild index.

### 3.5 Opening, keys, closing

**Open:**

- **⌘K / Ctrl+K** anywhere in the view outside the inline editor, which already stops propagation and keeps its own Mod+K link wrap. This needs a new `SHORTCUTS` entry `{id: "actions", group: "Results", keys: [key("KeyK", "K", {mod: true})], description: "Actions"}` and mod-key support in `matchShortcut` (§5).
- A click or tap on **Actions** in the footer.
- On mobile, a long-press on a row (§4).

**Keys while open** (handled in the filter field's `onKeyDown`):

- ↑/↓ move the highlight.
- ↵ runs the highlighted item.
- **Esc** closes the panel, or leaves the Move under sub-list, and puts focus back on the search input.
- ⌘K / Ctrl+K closes the panel.
- These keys call `stopPropagation` so the results list doesn't move. Every other key bubbles, so ⌥ shortcuts still work and run their action; running one closes the panel.

**Focus:**

- On desktop, the filter field is focused on open.
- On `Platform.isMobile` it is not focused, so the on-screen keyboard doesn't cover the list. Tapping it focuses it.

**Close:**

- a click or tap outside the panel and footer;
- a change of the selected row;
- a new query;
- a switch between Tree and Timeline;
- running an item.

**State:** `actionPanelStateAtom: {page: "main" | "moveUnder"; line: number} | null` in `SearchViewMolecule`, per view, with the derived `actionPanelAtom` (the page, or null). The panel is bound to the row selected when it opened: selecting another row closes it through the derived atom, with no effect racing a long-press that selects and opens in one step.

## 4. Mobile

- **Tap** keeps today's behavior (`selectHoveredLineAtom`): the first tap selects the row, and a tap on the already-selected row runs See in Obsidian. The footer then shows that row's main action and **Actions**.
- **Long-press:** a long-press (500 ms, cancelled by `touchmove`) selects the row and opens the panel. It applies to every row in every view that has the footer, not only editable rows.
  - The click that ends the long-press is suppressed, as in the current hook.
  - Rows get `-webkit-touch-callout: none; user-select: none` on `Platform.isMobile`. `onContextMenu` calls `preventDefault` on mobile, so the system link preview and text selection don't take the gesture.
- **Removed on mobile:**
  - the always-visible ⊕ dots: delete `mobileAppendDots` and its tests, so mobile renders no dots;
  - the long-press that opens Edit; Edit is **Edit line** in the panel.
- **Reparent on mobile:** **Move under…** (§3.3) covers what drag does on desktop, for pages in the current results. Drag stays desktop-only.
- **Hook:** `useRowEditGestures` (`src/view/editor/row-editing-hooks.ts`) becomes `useRowGestures`, in `src/view/search/row-gestures.ts`.
  - Desktop: Alt+click opens Edit, gated on `allowEditing` and `editable` as today.
  - Mobile: long-press opens the panel, not gated on `allowEditing`.

## 5. Shortcut matching (`src/view/search/shortcuts.ts`)

- **`matchShortcut(ev, shortcuts, isMac)`:**
  - Drop the early `if (ev.metaKey) return null`.
  - A key matches when `code` matches, `alt` and `shift` match exactly, and the modifiers match:
    - on macOS: `!!k.mod === ev.metaKey && !!k.ctrl === ev.ctrlKey`;
    - elsewhere: `!!(k.mod || k.ctrl) === ev.ctrlKey && !ev.metaKey`.
  - Callers pass `Platform.isMacOS`.
- **Descriptions** (these show in the help panel and as panel titles):
  - `newEditor` becomes `Open editor`.
  - `append` becomes `Append to the row's note`; the panel title is `Append to [[P]]`.
- **Help:** the help panel (`SearchHelp`) lists `actions` under Results automatically, because it renders from `SHORTCUTS`.

## 6. Code removed

- `src/view/search/SearchActions.tsx`: replaced by `ActionFooter` and `ActionPanel`.
- The removed `SearchBar` buttons and their now-unused atom subscriptions (`decExpandAtom`, `incExpandAtom`, `resetCollapseAtom`, `getExpandLevel` and `openBlankEditorAtom` in `SearchBar`), plus the `SquarePen` import there.
- `mobileAppendDots` (`src/view/editor/row-editing.ts`) and the mobile branch in `SearchViewFlatten`'s `decorations`.
- `useRowEditGestures`: replaced by `useRowGestures`.
- `EDITOR.md`: the pencil button and the mobile ⊕/long-press-edit text, updated to match this spec.

## 7. Risks

- **⌘K and Obsidian hotkeys.** Obsidian's hotkeys run before React sees the key; in the dev vault `tree-search:file-context` is bound to Mod+K. `KeyComboWrapper` therefore claims ⌘K / Ctrl+K in the window's capture phase (`preventDefault` + `stopImmediatePropagation`) when the key's target is inside the view and not inside the inline editor, which keeps its own Mod+K. Elsewhere, the Obsidian binding still applies. Live-checked: ⌘K from the search input and the panel filter toggles the panel.
- **Escape** in the panel goes through an Obsidian `Scope` pushed while focus is in the panel (as the inline editor does), so it closes the panel (or leaves Move under) instead of the modal.
- **Obsidian's floating mobile navbar** may cover the footer at the bottom of the pane or modal. Add `padding-bottom: env(safe-area-inset-bottom)` and check on a device, or with `app.emulateMobile(true)` in a test vault.
- **Stacked auxiliary panes** in the right sidebar each get their own footer, the same as each has an action bar today.

## 8. Testing

- **Unit** (`src/__tests__/action-panel.test.ts`), for `panelItems`:
  - With no selection, only the View section is returned.
  - With editing, `insert` is left out and **Append to [[P]]** carries the target's name.
  - **Edit line** appears only for editable rows.
  - **Move under…** appears only for draggable Tree rows, and never in Timeline.
  - Tree-only View items are hidden in Timeline mode.
  - Quick Link has no Edit section, and its main action is **Insert [[x]]**.
  - Filtering by title hides sections that end up empty.
- **Unit** (`src/__tests__/shortcuts.test.ts`):
  - ⌘K matches `actions` on macOS; Ctrl+K matches elsewhere.
  - ⌘C on macOS does not match `copy` (Ctrl+C).
  - Existing Alt and Ctrl matches are unchanged.
- **Unit** (`src/__tests__/row-editing.test.ts`): delete the `mobileAppendDots` tests.
- **Live check**, per AGENTS.md "Live Obsidian Testing":
  - **Search modal**, query `coworker`:
    - The search row has only the input, Clear and the Tree/Timeline switch.
    - Select a row; the footer shows its title, main action and Actions.
    - ⌘K opens the panel with the filter focused. Type `arch`: only Archive remains.
    - Esc closes the panel and focus is back in the search input.
    - Open **Move under…** and choose a page. The row moves, as with drag. Restore the note afterwards.
    - **Open editor** from the panel opens the blank editor.
  - **Search pane:** clicking the footer's **Actions** opens the panel. In Timeline mode, Tree-only items are absent.
  - **Mobile emulation**, only with user approval (it switches the whole app UI):
    - Long-press a row: it is selected and the panel opens without the keyboard.
    - No ⊕ dots show.
    - The footer is not covered by the navbar.
  - `await tab.errors()` is empty.
