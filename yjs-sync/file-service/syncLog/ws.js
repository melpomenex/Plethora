/**

 WS /rooms/{room}?since=N (design.md §4.2): pushes new seq values as they
 land, no payloads on the socket — clients pull via GET /ops on receipt.

 Auth note: the browser WebSocket constructor cannot set custom request
 headers, so unlike the HTTP routes (X-Sync-Timestamp / X-Sync-Signature
 headers), this endpoint takes the same two values as query parameters
 (`ts`, `sig`) on the upgrade request. The signed path is the pathname plus
 every OTHER query parameter (e.g. `since`) in their original order, with
 `ts`/`sig` themselves excluded (they can't sign themselves) — the delta-log
 client (Phase 4) must build the URL as `/rooms/{room}?since=N`, sign THAT
 string as the path, then append `&ts=...&sig=...` only to the string it
 actually connects with.

*/

import { authenticate } from "./auth.js";

const rooms = new Map(); // room -> Set<WebSocket>

export function notifyRoom(room, head) {
  const sockets = rooms.get(room);
  if (!sockets || sockets.size === 0) return;
  const message = JSON.stringify({ head });
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(message);
  }
}

/**
 * Wire a `ws` WebSocketServer's connection handling for /rooms/:room.
 * Call once at startup with the WebSocketServer and the open db handle.
 */
export function attachSyncLogWs(wss, db) {
  wss.on("connection", (ws, req, room) => {
    let set = rooms.get(room);
    if (!set) {
      set = new Set();
      rooms.set(room, set);
    }
    set.add(ws);

    ws.on("close", () => {
      set.delete(ws);
      // Retain no in-memory state for an idle room (spec.md: "A room
      // becomes idle" scenario) once its last socket disconnects.
      if (set.size === 0) rooms.delete(room);
    });
  });

  return {
    /**
     * Call from the http.Server's 'upgrade' event. Returns true if this
     * upgrade was handled (matched /rooms/:room), false otherwise so the
     * caller can let other upgrade handlers (or a 404) take it.
     */
    handleUpgrade(req, socket, head) {
      let url;
      try {
        url = new URL(req.url, "http://localhost");
      } catch {
        socket.destroy();
        return true;
      }
      const match = url.pathname.match(/^\/rooms\/([^/]+)$/);
      if (!match) return false;
      const room = match[1];

      const ts = url.searchParams.get("ts");
      const sig = url.searchParams.get("sig");
      const signedParams = new URLSearchParams(url.searchParams);
      signedParams.delete("ts");
      signedParams.delete("sig");
      const signedPath =
        url.pathname + (signedParams.size > 0 ? `?${signedParams.toString()}` : "");

      const authKey = authenticate(
        db,
        room,
        { method: "GET", path: signedPath, body: "" },
        { timestamp: ts, signature: sig },
      );
      if (!authKey) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return true;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, room);
      });
      return true;
    },
  };
}
