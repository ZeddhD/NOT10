/**
 * NOT10 server: serves the static frontend, a health check, and the
 * WebSocket endpoint multiplayer runs over. No database, no external
 * service - all game state lives in server/rooms.js's in-memory
 * RoomManager, matching a single self-contained Docker service.
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 8000;

// Only these top-level entries are servable as static files - keeps the
// server code, package.json, etc. off the public HTTP surface even though
// they live in the same repo.
const STATIC_ROOTS = ['index.html', 'assets', 'engine'];

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
};

function isServableStaticPath(relPath) {
    const normalized = relPath.replace(/^\/+/, '');
    const top = normalized.split('/')[0];
    return STATIC_ROOTS.includes(top) || normalized === '';
}

async function serveStatic(req, res) {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';

    if (!isServableStaticPath(urlPath)) {
        res.writeHead(404).end('Not found');
        return;
    }

    const filePath = path.join(REPO_ROOT, urlPath);
    // Guard against path traversal escaping REPO_ROOT
    if (!filePath.startsWith(REPO_ROOT)) {
        res.writeHead(403).end('Forbidden');
        return;
    }

    try {
        const stat = await fsp.stat(filePath);
        if (stat.isDirectory()) {
            res.writeHead(404).end('Not found');
            return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
    } catch {
        res.writeHead(404).end('Not found');
    }
}

const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
        return;
    }
    serveStatic(req, res);
});

const wss = new WebSocketServer({ server, path: '/ws' });
const roomManager = new RoomManager();

wss.on('connection', (ws) => {
    ws.on('message', (raw) => roomManager.handleMessage(ws, raw));
    ws.on('close', () => roomManager.handleDisconnect(ws));
    ws.on('error', () => roomManager.handleDisconnect(ws));
});

server.listen(PORT, () => {
    console.log(`NOT10 server listening on port ${PORT}`);
});
