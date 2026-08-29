## Purpose

Lets a user consolidate a topic's scattered graph relations (nested bare-wikilink captures, page mentions) into a single, de-duplicated outline on the note they're currently working in, and cleans up the source lines that are made redundant by doing so.

## ADDED Requirements

### Requirement: Pull children is triggerable from a command and from the result action list
The system SHALL expose "Pull children" as an Obsidian command (bindable to a hotkey) and as an entry in the tree-search result action list for a selected node, consistent with existing entries (Copy Node, Insert After, Archive).

#### Scenario: Triggered via command palette
- **WHEN** a node is selected in the tree-search view (or the cursor is on a line resolvable to a node) and the user runs the "Tree Search: Pull into this note" command
- **THEN** the system begins building a preview for that node

#### Scenario: Triggered via result action list
- **WHEN** a node is selected in a tree-search result and the user activates the "Pull children" action from the action list
- **THEN** the system begins building a preview for that node, identically to the command trigger

### Requirement: Subtree traversal is depth-limited and deduplicated
The system SHALL build the candidate subtree for the selected node by traversing its graph relations up to 5 levels deep. If the same node is reachable via more than one path within that depth limit, it SHALL appear only once, at its first-encountered position.

#### Scenario: Deep chain is truncated
- **WHEN** the selected node has a chain of relations 7 levels deep
- **THEN** only the first 5 levels are included in the candidate subtree

#### Scenario: Diamond relation is deduplicated
- **WHEN** a node is reachable from the selected node via two different paths within the depth limit
- **THEN** the candidate subtree includes that node once, at the position where it was first encountered during traversal

### Requirement: A preview is shown before any file is modified
The system SHALL display the full candidate subtree in a preview before writing or deleting anything, as a checkable tree where every node defaults to checked. The user SHALL be able to uncheck any node, which also excludes its descendants. No file is modified until the user confirms the preview.

#### Scenario: User excludes a branch
- **WHEN** the user unchecks a node in the preview
- **THEN** that node and all of its descendants are excluded from both the write and the delete step, and remain untouched in their source files

#### Scenario: User cancels
- **WHEN** the user dismisses the preview without confirming
- **THEN** no file is read for writing, no line is inserted, and no line is deleted

### Requirement: Preview flags nodes that already exist in the destination note
For each node in the candidate subtree, the system SHALL check whether that node already has an occurrence in the note that will receive the pull, and SHALL visibly flag any such node in the preview.

#### Scenario: Node already present in destination
- **WHEN** a candidate node already occurs somewhere in the active note
- **THEN** the preview flags that node as already present, and shows its existing location

### Requirement: Checked lines are inserted verbatim with a provenance date
For each checked node, the system SHALL insert its source line's text unchanged (no stripping of links or other content), with the recorded date of that occurrence appended to the line.

#### Scenario: Line with extra content is preserved
- **WHEN** a checked node's source line contains a wikilink plus additional text (e.g. a URL or plain text)
- **THEN** the inserted line contains that exact text, unchanged, followed by the occurrence's date

### Requirement: A flagged-and-still-checked node merges under its existing occurrence
When a node is flagged as already present in the destination note and the user leaves it checked, the system SHALL insert its new checked children as additional lines nested under the existing occurrence's line, rather than inserting a new, duplicate top-level line for that node.

#### Scenario: Re-running the pull after new captures appear
- **WHEN** a node was pulled into a note in a previous run and now has new checked children collected from elsewhere in the vault
- **THEN** confirming the preview appends only the new children under the node's existing line in that note, without creating a second copy of the node

### Requirement: Unflagged nodes insert fresh at the cursor
When a checked node has no existing occurrence in the destination note, the system SHALL insert it (and its checked children) as new lines at the cursor position in the active note.

#### Scenario: First-time pull of a node
- **WHEN** a checked node does not already occur in the active note
- **THEN** its line and checked children are inserted as new content at the cursor

### Requirement: Source line deletion is non-aggressive
After a successful pull, the system SHALL delete a source line only if removing the pulled content leaves that line with no remaining text and no remaining un-pulled children. A source line that still carries other content, or still has children that were not part of the confirmed selection, SHALL be left unmodified.

#### Scenario: Source line fully consumed
- **WHEN** a checked node's source line consists only of the pulled content and has no un-pulled children
- **THEN** that line is deleted from its source file

#### Scenario: Source line partially consumed
- **WHEN** a source line has additional content or un-pulled children beyond what was checked
- **THEN** that line is left in place, unmodified

#### Scenario: Mention outside the pulled subtree is untouched
- **WHEN** a node that was pulled also has other occurrences in the vault that were not part of the candidate subtree for this pull
- **THEN** those other occurrences are left unmodified
