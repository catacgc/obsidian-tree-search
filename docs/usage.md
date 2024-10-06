# Usage

## Simple Example

The idea is that you can link notes together in a hierarchy where the hierarchy is made up of nodes in the note.

Here's a simple example (try to reproduce in your vault). You have daily/weekly notes where you jolt down your references and notes through the day.

In `MyNotes.md` you have the following:

```markdown
# September

- [[Obsidian]]
	- [Tree Search](https://github.com/catacgc/obsidian-tree-search) is awesome; install with [[BRAT]]
		- [ ] check it out 
```

Consider for a moment what can be derived from this simple note.
- Obsidian is a parent of `Tree Search`
- BRAT is referenced when mentioning `Tree Search`
- MyNotes#September is a parent of `Obsidian`
- `- [ ] check it out` is a task under `Tree Search`

Obsidian falls short in helping you visualize and search these relations. This is where TreeSearch comes in.

## Searching

The plugin creates a directed graph for all these elements and adds a new command `TreeSearch: Search` or `TreeSearch: Search Modal` that opens a new pane with a search bar.

You can search for a note and see all the notes (and links) that are nested under it.

With our example, search for `obsidian`, and you will see the following:

![obsidian.png](obsidian.png)

Clicking on any result item will highlight the note where the relation was recorded. Clicking on the note or a web link will open it.

![img.png](click.png)

Going beyond this trivial example, you can imagine how powerful this can be for a large vault.
If you spend a minimal amount of time to create some MOC (Maps of Content) you can easily navigate and retrieve items in your vault.

# Advanced Example

Let's create a note to exemplify the full set of features of the plugin: 'Work.md'
Add an alias to this note: `Documentation`

```markdown
# My MOC
- [[MyCompany]]
	- [[Projects]]
	- [[Team]]
	- [[Stakeholders]]

- [[Projects]]
	- [[FirstProject]]
	- [[SecondProject]]

- [[Team]]
	- [[Joe]]
	- [[John]]
# Tasks
- [ ] Finish the design document for [[FirstProject]]

# Notes
- [[FirstProject]]
	- [Design Document](http://link) created by [[Joe]]

- Let [[John]] know about the recent change
```

## Maps of Content (MOC)

A very useful feature of the plugin is the ability to create a map of content and search them. Search Work or Documentation to see it in action.

![img.png](work.png)


## Nested search

You can use the `/` separator (configurable in settings) between keywords to match sub-trees. For example `projects / joe` will show all projects
where Joe was mentioned:

![img.png](nested.png)
