# Obsidian TreeSearch Plugin

This is a very early phase plugin for Obsidian to help navigate a hierarchy of notes and connections.

Obsidian is good at linking notes together. What this plugin does is to add another layer to the linking
capabilies of obsidian, namely hierarchical linking.

Consider the following example: you have daily/weekly notes where you jolt down your references and notes through the day.

in `2026-01-01.md` you have the following:

```markdown
- [[Project1]]
	- [An external link to remember](https://company-reference) #bookmark
```

As your work progresses you add more notes, nested with a hierarchy that evolves as your work evolves.
Obsidian is good at linking these notes together easily. You start adding more important links

```markdown
- [[Project1]]
	- [[Project1 Task]] with some optional inline context
		- https://task-tracker/item - this is something I should keep track of temporarily

- [[Project2]]
	- https://my-project-himepage #bookmark/important
```

Not let's decide you want to start organizing a bit and organize your more important projects [[ImportantProjects]] page 

```markdown
- [[Project1]]
- [[Project2]] 
```

TreeSearch let's search and explore these connections across your vault, easily.

![img.png](docs/img/img.png)

## Nested Search

The plugin adds a new command `TreeSearch: Search` that opens a new pane with a search bar. 
You can search for a note and see all the notes (and links) that are nested under it.

The search algo is very simple and only supports exact matches for now. There are only two operators you should care about:
- `>` - searches down in the tee 

## Development

```bash
npm install
npm run test:watch
```

## Funding URL

You can include funding URLs where people who use your plugin can financially support it.

The simple way is to set the `fundingUrl` field to your link in your `manifest.json` file:

```json
{
    "fundingUrl": "https://buymeacoffee.com"
}
```

If you have multiple URLs, you can also do:

```json
{
    "fundingUrl": {
        "Buy Me a Coffee": "https://buymeacoffee.com",
        "GitHub Sponsor": "https://github.com/sponsors",
        "Patreon": "https://www.patreon.com/"
    }
}
```

## API Documentation

See https://github.com/obsidianmd/obsidian-api
