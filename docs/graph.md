# How it works

This plugin adds another layer to this Obsidian's linking system, namely hierarchical linking of List Nodes & Pages in the vault.

## Graph Nodes

Even if the plugin is called TreeSearch, the underlying data structure is a directed graph.

Nodes tracked by this plugin are:
- All vault notes
- List items that
    - Have links to other notes
    - Have links to web pages
    - Have tags
- All virtual pages (notes that are not in the vault but are linked to)
- Headers (only if they have List items under them)

| Node                                                   | Type         | Description                                                                  |
|--------------------------------------------------------|--------------|------------------------------------------------------------------------------|
| `MyCompany.md`                                         | Page         | A note in the vault                                                          |
| `[[Projects]]`                                         | Virtual Page | Whenever the page does not exist in the vault, but there's still a reference |
| `- [Design Document](http://link) created by [[Joe]]`  | List Item    | All vault lines that contain a Web or a Vault reference                      |
| `## Header`                                            | Header       | A header in a note, if it has List Item children                             |
| `- [ ] Task`                                           | Task         | A task in a note                                                             |

## Directed Edges

The plugin track relations between nodes. The relation have the direction implied by the outline:
- If a Page is under another Page, the first is a child of the second
- If a List Item is under another List Item, the first is a child of the second
- If a List Item is under a Header, the first is a child of the Header
- If a List Item is under a Page, the first is a child of the Page
- If a List Item contains multiple references to other Pages, all Pages are parents of the List Item
- Tasks are treated identical to List Items
