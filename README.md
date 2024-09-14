# Obsidian TreeSearch Plugin

This is a very early phase plugin for Obsidian to help navigate a hierarchy of notes and connections.

Obsidian is good at linking notes together. What this plugin does is to add another layer to the linking
capabilies of obsidian, namely hierarchical linking.

Consider the following example: you have daily/weekly notes where you jolt down your references and notes through the day.

in `2026-01-01.md` you have the following:

```markdown
- [[MyArea]]
	- [[MyProject]]
		- https://my-project-reference #bookmark
```

in another day, you decide you want to add a note to `My Project` in `2026-01-02.md`. Most natural way to do so in Obsidian
is to quickly nest it in your otline

```markdown
- [[MyProject]]
	- [[MyProject Task]] with some optional inline context
```

yet another day comes and you start ading some references tot the area you're working on in `2026-01-03.md`

```markdown
- [[MyArea]]
	- https://some-web-reference #bookmark/important
```

TreeSearch let's explore these connections quickly and easily.

![img.png](docs/img/img.png)

## Nested Search

The plugin adds a new command `TreeSearch: Search` that opens a new pane with a search bar. 
You can search for a note and see all the notes (and links) that are nested under it.

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
