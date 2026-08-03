#!/usr/bin/env node

/**

 Entry point for the forked y-websocket relay. Identical to upstream
 `y-websocket/bin/server.js` except it requires our local `./utils.js`
 (which adds opaque-forwarding for unknown message types — see the header
 in that file).

*/

const WebSocket = require('ws')
const http = require('http')
// Task 0.5: bound max payload well under the box's memory, not just under
// "implausible". Target deployment is a 1-core / 1 GB VPS shared with the
// file-service; 256 MiB was itself most of that budget for a single frame.
// FRAME_LOG_MAX_FRAME_BYTES (16 MiB, see frameLog.js) already caps what the
// relay will persist, so bound the wire payload to match — anything bigger
// could never be replayed anyway, and closing with 1009 MESSAGE_TOO_BIG for
// a genuinely pathological frame is preferable to accepting it into memory.
const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024
const wss = new WebSocket.Server({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES })
const setupWSConnection = require('./utils.js').setupWSConnection

const host = process.env.HOST || 'localhost'
const port = process.env.PORT || 1234

const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end('okay')
})

wss.on('connection', setupWSConnection)

server.on('upgrade', (request, socket, head) => {
  const handleAuth = ws => {
    wss.emit('connection', ws, request)
  }
  wss.handleUpgrade(request, socket, head, handleAuth)
})

server.listen(port, host, () => {
  console.log(`forked y-websocket relay running at '${host}' on port ${port}`)
})
