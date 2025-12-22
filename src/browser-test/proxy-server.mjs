import http from 'http';
import fs from 'fs';

/**
 * Simple HTTP proxy server that forwards requests to the RaycastServer Unix socket.
 * This allows the browser test environment to access the graph data.
 * 
 * Usage: 
 *   node src/browser-test/proxy-server.mjs [vault-name]
 *   node src/browser-test/proxy-server.mjs --socket /path/to/socket.sock
 *   node src/browser-test/proxy-server.mjs --port 3001
 * 
 * Examples:
 *   npm run proxy                                    # Use default vault name
 *   npm run proxy my-vault                           # Specify vault name
 *   npm run proxy -- --socket /tmp/custom.sock       # Specify socket path
 *   npm run proxy -- --port 3001                     # Use different port
 */

const DEFAULT_PROXY_PORT = 3000;
const DEFAULT_SOCKET_PATH = '/tmp/tree-search-{vaultname}.sock';

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    let socketPath = null;
    let port = DEFAULT_PROXY_PORT;
    let vaultName = null;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--socket' && i + 1 < args.length) {
            socketPath = args[i + 1];
            i++;
        } else if (arg === '--port' && i + 1 < args.length) {
            port = parseInt(args[i + 1]);
            i++;
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
Browser Test Proxy Server

Usage:
  npm run proxy [vault-name]
  npm run proxy -- --socket <path>
  npm run proxy -- --port <port>

Options:
  vault-name              Vault name to connect to (default: browser-test-vault)
  --socket <path>         Direct path to Unix socket
  --port <port>           HTTP port to listen on (default: 3000)
  --help, -h              Show this help message

Examples:
  npm run proxy                                    # Use default vault
  npm run proxy my-vault                           # Connect to 'my-vault'
  npm run proxy -- --socket /tmp/custom.sock       # Use custom socket path
  npm run proxy -- --port 3001                     # Listen on port 3001
            `);
            process.exit(0);
        } else if (!arg.startsWith('--')) {
            vaultName = arg;
        }
    }

    // Determine socket path
    if (!socketPath) {
        if (!vaultName) {
            // Try to auto-detect from /tmp
            const tmpFiles = fs.readdirSync('/tmp').filter(f => f.startsWith('tree-search-') && f.endsWith('.sock'));
            if (tmpFiles.length === 1) {
                socketPath = `/tmp/${tmpFiles[0]}`;
                console.log(`Auto-detected socket: ${socketPath}`);
            } else if (tmpFiles.length > 1) {
                console.log(`\nMultiple sockets found in /tmp:`);
                tmpFiles.forEach(f => console.log(`  - ${f}`));
                console.log(`\nPlease specify vault name or socket path.`);
                console.log(`Example: npm run proxy my-vault\n`);
                process.exit(1);
            } else {
                vaultName = 'browser-test-vault';
                socketPath = DEFAULT_SOCKET_PATH.replace('{vaultname}', vaultName);
            }
        } else {
            socketPath = DEFAULT_SOCKET_PATH.replace('{vaultname}', vaultName);
        }
    }

    return { socketPath, port };
}

const { socketPath, port: PROXY_PORT } = parseArgs();

console.log(`Starting HTTP proxy server on port ${PROXY_PORT}`);
console.log(`Forwarding to Unix socket: ${socketPath}`);

const server = http.createServer((req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Check if socket exists
    if (!fs.existsSync(socketPath)) {
        res.writeHead(503);
        res.end(JSON.stringify({
            error: 'RaycastServer socket not found',
            socketPath,
            message: 'Make sure Obsidian is running with the plugin loaded'
        }));
        return;
    }

    // Forward request to Unix socket
    const options = {
        socketPath,
        path: req.url,
        method: req.method,
        headers: req.headers
    };

    const proxyReq = http.request(options, (proxyRes) => {
        // Forward response headers
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);

        // Forward response body
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
        console.error('Proxy request error:', err);
        res.writeHead(500);
        res.end(JSON.stringify({
            error: 'Failed to connect to RaycastServer',
            message: err.message
        }));
    });

    // Forward request body
    req.pipe(proxyReq);
});

server.listen(PROXY_PORT, () => {
    console.log(`\n✓ Proxy server running on http://localhost:${PROXY_PORT}`);
    console.log(`✓ Forwarding to socket: ${socketPath}`);
    console.log(`\nTo use with browser test:`);
    console.log(`1. Make sure Obsidian is running with the plugin loaded`);
    console.log(`2. Run: npm run dev:browser`);
    console.log(`3. Open: dist/browser-test/index.html in your browser\n`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n✗ Port ${PROXY_PORT} is already in use`);
        console.error(`  Stop the other process or change PROXY_PORT in this file\n`);
    } else {
        console.error('Server error:', err);
    }
    process.exit(1);
});
