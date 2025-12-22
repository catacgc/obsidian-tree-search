# Browser Test Environment

Test the SearchModal component in a browser without Obsidian.

## Quick Start

1. **Start Obsidian** with the plugin loaded
2. **Start the proxy server**: `npm run proxy`
3. **Build the browser bundle**: `npm run dev:browser`
4. **Open in browser**: Open `dist/browser-test/index.html`

## What This Does

This browser test environment allows you to:
- Test the SearchModal component outside of Obsidian
- Debug search functionality in browser DevTools
- Iterate on UI changes faster without reloading Obsidian
- Verify search results against your actual vault data

## How It Works

1. **RaycastServer** exposes a `/graph` endpoint that returns the vault graph as JSON
2. **Proxy Server** (port 3000) forwards HTTP requests to the Unix socket
3. **Browser Bundle** fetches the graph data and renders the SearchModal component
4. **Mock Modules** provide stub implementations of Obsidian APIs

### Proxy Server Options

The proxy server supports several configuration options:

```bash
# Auto-detect socket (if only one vault is running)
npm run proxy

# Specify vault name
npm run proxy my-vault-name

# Specify socket path directly
npm run proxy -- --socket /tmp/tree-search-custom.sock

# Use a different port
npm run proxy -- --port 3001

# Show help
npm run proxy -- --help
```

## Files

- `index.html` - Standalone HTML page
- `main.tsx` - Browser entry point (fetches graph, renders component)
- `mock-app.ts` - Mock Obsidian App implementation
- `mock-obsidian.ts` - Mock Obsidian module (Platform, Modal, etc.)
- `proxy-server.mjs` - HTTP proxy for Unix socket access

## Troubleshooting

### "Failed to fetch graph data"
- Ensure Obsidian is running with the plugin loaded
- Check that the RaycastServer is running (Obsidian console should show "Server is Listening...")
- Verify the proxy server is running on port 3000

### "Port 3000 is already in use"
- Stop the other process using port 3000, or
- Edit `proxy-server.mjs` and change `PROXY_PORT` to a different port
- Update `main.tsx` to use the new port in the fetch URL

### Build errors
- Run `npm install` to ensure all dependencies are installed
- Check that `esbuild.browser.config.mjs` exists
- Verify the mock modules are in place

## Development

The browser bundle is built with esbuild and includes:
- All React components
- Graph data structures (graphology)
- Jotai state management
- Mock Obsidian APIs

The bundle is ~5.2MB because it includes all dependencies (no externals).

## Notes

- Graph data is fetched once on page load
- Refresh the page to get updated graph data
- The SearchModal component is reused without modification
- Mock implementations log warnings when unimplemented methods are called
