# Crew-Managed Infrastructure

This project uses **crew** to manage plugins, MCP servers, and credentials.

The following entries in `.claude/settings.local.json` are managed by crew and should not be manually edited:
- `extraKnownMarketplaces["crew-plugins"]`
- `enabledPlugins` entries ending in `@crew-plugins`


## Setup & Configuration

- `crew config <server>` — configure credentials for an MCP server
- `crew install` — install/update all plugin dependencies
- `crew doctor` — diagnose issues

## Crew-Specific Features

These features are available through the crew web UI (`crew serve`) but not directly in Claude Code CLI:
- **/display** — rich media rendering (images, charts, documents inline)
- **Context compression** — automatic conversation optimization
- **Coordinator agent routing** — tasks delegated to specialist sub-agents
