/**
 * WebSocket transport for NOT10 multiplayer.
 * Owns the socket connection, reconnection, and message (de)serialization
 * only - no game rules, no UI. The thin network layer app.js sits on top
 * of, counterpart to server/rooms.js on the other end.
 */

let socket = null;
let onMessage = null;
let onOpen = null;
let reconnectAttempts = 0;
let intentionalClose = false;
let pendingQueue = [];

function wsUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
}

/**
 * Open the connection (auto-reconnects with backoff on unexpected drops).
 * @param {Function} messageHandler - called with each parsed server message
 * @param {Function} openHandler - called every time the socket (re)connects
 */
export function connect(messageHandler, openHandler) {
    onMessage = messageHandler;
    onOpen = openHandler;
    intentionalClose = false;
    _open();
}

function _open() {
    socket = new WebSocket(wsUrl());

    socket.addEventListener('open', () => {
        reconnectAttempts = 0;
        const queued = pendingQueue;
        pendingQueue = [];
        for (const msg of queued) socket.send(JSON.stringify(msg));
        onOpen?.();
    });

    socket.addEventListener('message', (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch (err) {
            console.error('Failed to parse server message:', err);
            return;
        }
        onMessage?.(data);
    });

    socket.addEventListener('close', () => {
        if (intentionalClose) return;
        reconnectAttempts++;
        const delay = Math.min(1000 * reconnectAttempts, 5000);
        setTimeout(_open, delay);
    });

    // 'error' is always followed by 'close', which schedules the reconnect
    socket.addEventListener('error', () => {});
}

/**
 * Send a message. If the socket is mid-reconnect, it's queued and flushed
 * once the connection reopens.
 * @param {Object} payload
 */
export function send(payload) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
    } else {
        pendingQueue.push(payload);
    }
}

export function isConnected() {
    return !!socket && socket.readyState === WebSocket.OPEN;
}

export function disconnect() {
    intentionalClose = true;
    socket?.close();
}
