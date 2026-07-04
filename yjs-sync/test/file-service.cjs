#!/usr/bin/env node

/**

 Integration test for the (now-opaque) file-service.

 Pins two properties that matter for the end-to-end-encryption rollout:

   1. Encrypted upload path: a client can POST opaque ciphertext bytes plus
      an `encMetadata` form field; the server stores them verbatim, serves
      the bytes back as application/octet-stream, and echoes `encMetadata`
      via the X-Encrypted-Metadata response header. The server MUST NOT
      interpret, store, or echo the original filename/content-type.

   2. Legacy plaintext path: an upload with no `encMetadata` keeps working
      (filename/contentType served as before), so existing pre-encryption
      blobs remain readable during the transition.

 Runs as a standalone Node script (not under vitest) because it spawns a
 real server. Exit code 0 = pass, non-zero = fail.

*/

const { spawn } = require('child_process')
const http = require('http')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')

const SERVER_PATH = path.join(__dirname, '..', 'file-service', 'index.js')

function pickPort() {
  return 10000 + Math.floor(Math.random() * 50000)
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yjs-file-service-'))
}

function waitForReady(port, attemptsLeft = 100) {
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        res.destroy()
        resolve()
      })
      req.on('error', () => {
        if (attemptsLeft <= 0) reject(new Error('server never became ready'))
        else setTimeout(() => waitForReady(port, attemptsLeft - 1).then(resolve, reject), 100)
      })
      req.setTimeout(1000, () => {
        req.destroy()
        if (attemptsLeft <= 0) reject(new Error('server never became ready'))
        else setTimeout(() => waitForReady(port, attemptsLeft - 1).then(resolve, reject), 100)
      })
    }
    tryConnect()
  })
}

async function withServer(fn) {
  const port = pickPort()
  const dataDir = makeTempDir()
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, PORT: String(port), FILES_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stderr = []
  child.stderr.on('data', (chunk) => stderr.push(chunk))
  child.stdout.on('data', () => {})

  try {
    await waitForReady(port)
    return await fn(port, dataDir)
  } finally {
    child.kill('SIGTERM')
    fs.rmSync(dataDir, { recursive: true, force: true })
    if (stderr.length) {
      process.stderr.write(Buffer.concat(stderr).toString())
    }
  }
}

// Multipart form-data construction (no dependency on a client lib).
function buildMultipart(fields, file) {
  const boundary = '----yjs-test-' + crypto.randomBytes(8).toString('hex')
  const parts = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    )
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
    )
    parts.push(file.bytes)
    parts.push(Buffer.from('\r\n'))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}

function request(method, url, { body, contentType } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {},
    }
    if (contentType) opts.headers['Content-Type'] = contentType
    if (body) opts.headers['Content-Length'] = body.length
    const req = http.request(opts, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }),
      )
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function testEncryptedUploadRoundTrip(port) {
  const room = 'testroom-encrypted-' + crypto.randomBytes(4).toString('hex')
  // Pad room to >= 8 chars (isSafeRoom requires it).
  const safeRoom = room.padEnd(12, '0')
  const id = crypto.randomUUID()
  const plaintext = crypto.randomBytes(2048)
  // Fake ciphertext: just random bytes standing in for AES-GCM output.
  const ciphertext = crypto.randomBytes(plaintext.length + 28)
  const encMetadata = btoa('opaque-client-encrypted-metadata-blob')

  const { body, contentType } = buildMultipart(
    { encMetadata },
    { filename: `${id}.bin`, contentType: 'application/octet-stream', bytes: ciphertext },
  )

  const uploadRes = await request(
    'POST',
    `http://127.0.0.1:${port}/files/${safeRoom}?id=${id}`,
    { body, contentType },
  )
  if (uploadRes.status !== 201) {
    throw new Error(`upload failed: status ${uploadRes.status}, body ${uploadRes.body}`)
  }
  const meta = JSON.parse(uploadRes.body.toString())
  if (meta.filename !== undefined) {
    throw new Error(`encrypted upload leaked filename: ${meta.filename}`)
  }
  if (meta.contentType !== undefined) {
    throw new Error(`encrypted upload leaked contentType: ${meta.contentType}`)
  }
  if (meta.encMetadata !== encMetadata) {
    throw new Error('encMetadata not stored verbatim')
  }
  if (meta.sizeBytes !== ciphertext.length) {
    throw new Error(`sizeBytes mismatch: expected ${ciphertext.length}, got ${meta.sizeBytes}`)
  }

  // GET the blob back.
  const getRes = await request('GET', `http://127.0.0.1:${port}/files/${safeRoom}/${id}`)
  if (getRes.status !== 200) {
    throw new Error(`download failed: status ${getRes.status}`)
  }
  if (getRes.headers['content-type'] !== 'application/octet-stream') {
    throw new Error(`expected octet-stream, got ${getRes.headers['content-type']}`)
  }
  if (getRes.headers['x-encrypted-metadata'] !== encMetadata) {
    throw new Error('X-Encrypted-Metadata header not echoed on download')
  }
  if (!getRes.body.equals(ciphertext)) {
    throw new Error('downloaded bytes do not match uploaded ciphertext')
  }
}

async function testLegacyPlaintextUpload(port) {
  const safeRoom = 'legacyroom0000'
  const id = crypto.randomUUID()
  const bytes = Buffer.from('%PDF-1.7 legacy plaintext upload\n')

  const { body, contentType } = buildMultipart({}, { filename: 'doc.pdf', contentType: 'application/pdf', bytes })

  const uploadRes = await request(
    'POST',
    `http://127.0.0.1:${port}/files/${safeRoom}?id=${id}`,
    { body, contentType },
  )
  if (uploadRes.status !== 201) {
    throw new Error(`legacy upload failed: status ${uploadRes.status}`)
  }
  const meta = JSON.parse(uploadRes.body.toString())
  if (meta.filename !== 'doc.pdf') {
    throw new Error(`legacy upload should keep filename, got ${meta.filename}`)
  }
  if (meta.contentType !== 'application/pdf') {
    throw new Error(`legacy upload should keep contentType, got ${meta.contentType}`)
  }
  if (meta.encMetadata !== null) {
    throw new Error(`legacy upload should have null encMetadata, got ${meta.encMetadata}`)
  }

  const getRes = await request('GET', `http://127.0.0.1:${port}/files/${safeRoom}/${id}`)
  if (getRes.status !== 200) {
    throw new Error(`legacy download failed: status ${getRes.status}`)
  }
  // Legacy path: original content-type is preserved (no encMetadata).
  if (getRes.headers['content-type'] !== 'application/pdf') {
    throw new Error(`legacy download content-type mismatch: ${getRes.headers['content-type']}`)
  }
  if (getRes.headers['x-encrypted-metadata'] !== undefined) {
    throw new Error('legacy download should NOT set X-Encrypted-Metadata')
  }
  if (!getRes.body.equals(bytes)) {
    throw new Error('legacy downloaded bytes do not match uploaded plaintext')
  }
}

async function main() {
  console.log('Spawning file-service and running opaque-storage tests...')
  await withServer(async (port) => {
    console.log('  test 1: encrypted upload stores ciphertext + encMetadata opaquely')
    await testEncryptedUploadRoundTrip(port)
    console.log('  ✓ ciphertext + encMetadata round-trip intact; no filename/type leak')

    console.log('  test 2: legacy plaintext upload still works (back-compat)')
    await testLegacyPlaintextUpload(port)
    console.log('  ✓ legacy filename/contentType preserved; no encMetadata header')
  })
  console.log('All file-service tests passed.')
}

main().catch((err) => {
  console.error('FAIL:', err.message || err)
  process.exit(1)
})
