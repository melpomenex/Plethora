import * as Y from "yjs";
import type { WebsocketProvider as WebsocketProviderType } from "y-websocket";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { encryptState, decryptState, DecryptError } from "./encryption";
import { recordSyncWorkSize } from "./syncTelemetry";
import { setSyncCheckpoint } from "./syncJournal";
import { scheduleProgressiveSyncWork, type SyncWorkContext } from "./progressiveScheduler";

// y-websocket message-type bytes (see node_modules/y-websocket/src/y-websocket.js).
// These are written/read as varuint, but all values fit in a single byte.
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_AUTH = 2;
const MESSAGE_QUERY_AWARENESS = 3;

// New message-type byte introduced by this wrapper. Signals that the remainder
// of the message is `encryptState(update)` output — i.e. AES-GCM ciphertext
// whose plaintext is the original y-websocket sync payload (everything after
// the sync message-type byte, including the sync sub-type). Chosen to not
// collide with the four values y-websocket defines.
//
// IMPORTANT relay constraint: the stock y-websocket relay (bin/utils.js) only
// handles messageSync/messageAwareness and SILENTLY DROPS any other type. For
// encrypted sync to actually replicate, the relay MUST be run in an opaque-
// forwarding mode (forward every binary frame to all other connections in the
// room, without parsing the message-type byte). The design doc states the relay
// "forwards opaque bytes"; that is a deployment requirement, not a property of
// the current y-websocket server. See the wrapper's README/limitation note.
const MESSAGE_ENCRYPTED_SYNC = 0x10;
let nextReplayProviderId = 1;

type WebsocketProviderConstructor = typeof WebsocketProviderType;

export interface EncryptedWebsocketProviderOptions {
  /**
   * Whether to open the WebSocket immediately (mirrors y-websocket's `connect`).
   * Defaults to true.
   */
  connect?: boolean;
  /**
   * Extra query-string params appended to the WebSocket URL.
   */
  params?: { [key: string]: string };
  /**
   * Resync interval in ms (-1 disables). Mirrors y-websocket.
   */
  resyncInterval?: number;
  /**
   * Max reconnect backoff in ms. Mirrors y-websocket.
   */
  maxBackoffTime?: number;
  /**
   * Disable cross-tab BroadcastChannel. Defaults to true in this wrapper —
   * BroadcastChannel would bypass the WebSocket transport where encryption
   * is applied, leaking plaintext to other tabs. Enable only if you understand
   * the implication (same-origin tabs share the device's decryption key anyway).
   */
  disableBc?: boolean;
}

/**
 * Wraps y-websocket's {@link WebsocketProvider} so that Yjs sync messages
 * (state vector exchange, state vector reply, document updates) are encrypted
 * with AES-GCM under `stateKey` before they touch the WebSocket, and decrypted
 * on the way back in. The relay sees only opaque ciphertext for these messages.
 *
 * Composition strategy: we instantiate the real `WebsocketProvider` with a
 * custom WebSocket polyfill that intercepts `send`/`onmessage`. This is
 * deliberately *not* a subclass — y-websocket's internals (`setupWS`,
 * `broadcastMessage`, the `_updateHandler` closure) are not part of the stable
 * API, and subclassing would couple us to their shape. The transport layer is
 * the single chokepoint where every wire byte flows, so wrapping there is both
 * sufficient and minimally invasive.
 *
 * Awareness messages (cursors, presence) are intentionally left in plaintext:
 * they are ephemeral, broadcast on a fixed cadence, and the y-websocket
 * awareness protocol is rigid. Encrypting them would require either a parallel
 * wrapper for `awarenessProtocol.encodeAwarenessUpdate` (which the provider
 * calls internally on a timer) or modifying the relay. The threat model in the
 * design doc scopes E2EE to "state and files"; awareness carries no document
 * content. If awareness confidentiality becomes a requirement, derive a
 * separate awareness sub-key and extend the wire format — but do not reuse the
 * state key, which has a counter-based nonce unsuited to high-frequency sends.
 */
export class EncryptedWebsocketProvider {
  readonly provider: WebsocketProviderType;
  private readonly stateKey: CryptoKey;
  private inboundReplayQueue: Array<{ data: ArrayBuffer | string; deliver: (data: ArrayBuffer | string) => void }> = [];
  private replayScheduled = false;
  private inboundReplayFrames = 0;
  private readonly replayProviderId = nextReplayProviderId++;

  constructor(
    WebsocketProvider: WebsocketProviderConstructor,
    serverUrl: string,
    roomname: string,
    doc: Y.Doc,
    stateKey: CryptoKey,
    opts: EncryptedWebsocketProviderOptions = {},
  ) {
    this.stateKey = stateKey;

    // The polyfill must be constructed *per instance* because it closes over
    // `this` (the EncryptedWebsocketProvider) to reach the decrypt path.
    const wsPolyfill = makeEncryptingWebSocketPolyfill(
      (data) => this.encryptOutbound(data),
      (data) => this.decryptInbound(data),
      (data, deliver) => this.enqueueInbound(data, deliver),
    );

    this.provider = new WebsocketProvider(serverUrl, roomname, doc, {
      connect: opts.connect ?? true,
      params: opts.params,
      WebSocketPolyfill: wsPolyfill,
      resyncInterval: opts.resyncInterval ?? -1,
      maxBackoffTime: opts.maxBackoffTime ?? 2500,
      // Default to disabling BroadcastChannel: it would carry plaintext sync
      // messages between same-origin tabs, defeating the encryption goal at the
      // intra-device boundary. Callers who only care about the relay boundary
      // can re-enable it.
      disableBc: opts.disableBc ?? true,
    });
  }

  /**
   * Encrypt an outbound y-websocket frame. Sync messages are re-encoded under
   * the {@link MESSAGE_ENCRYPTED_SYNC} type byte; all other message types pass
   * through unchanged so the protocol handshake and awareness keep working.
   *
   * Returns the bytes to actually put on the wire. When encryption would change
   * nothing (non-sync message), the original buffer is returned untouched.
   */
  private async encryptOutbound(buf: Uint8Array): Promise<Uint8Array> {
    const decoder = decoding.createDecoder(buf);
    const messageType = decoding.readVarUint(decoder);
    if (messageType !== MESSAGE_SYNC) {
      return buf;
    }

    // Pull the sync sub-type (step1=0 / step2=1 / update=2, see
    // y-protocols/sync.js) out into the plaintext envelope. Everything after
    // it — the actual Yjs state — is what gets encrypted. This lets the relay
    // decide whether a frame is worth persisting (never persist step1 queries)
    // without decrypting anything; only the sub-type is exposed.
    const subType = decoding.readVarUint(decoder);
    const plaintext = buf.subarray(decoder.pos);
    const ciphertext = await encryptState(plaintext, this.stateKey);

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_ENCRYPTED_SYNC);
    encoding.writeVarUint(encoder, subType);
    encoding.writeVarUint8Array(encoder, ciphertext);
    return encoding.toUint8Array(encoder);
  }

  /**
   * Decrypt an inbound frame. Encrypted-sync frames are unwrapped back to a
   * plain sync frame and handed to y-websocket. Frames with the wrong key or
   * tampered ciphertext are caught and dropped — sync must not crash because a
   * peer (or the relay) sent garbage. Non-encrypted frames pass through.
   */
  private async decryptInbound(buf: Uint8Array): Promise<Uint8Array | null> {
    const decoder = decoding.createDecoder(buf);
    const messageType = decoding.readVarUint(decoder);
    if (messageType !== MESSAGE_ENCRYPTED_SYNC) {
      return buf;
    }

    const subType = decoding.readVarUint(decoder);
    const ciphertext = decoding.readVarUint8Array(decoder);
    let plaintext: Uint8Array;
    try {
      plaintext = await decryptState(ciphertext, this.stateKey);
      recordSyncWorkSize(plaintext.byteLength, 1);
    } catch (err) {
      if (err instanceof DecryptError) {
        console.warn(
          "[EncryptedWebsocketProvider] dropping inbound message: decryption failed",
          err.message,
        );
        return null;
      }
      throw err;
    }

    // Reconstruct the original sync frame: message-type 0, then the sub-type
    // (carried in plaintext), then the decrypted state.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, subType);
    encoding.writeUint8Array(encoder, plaintext);
    return encoding.toUint8Array(encoder);
  }

  /** Apply encrypted frame-log updates in bounded batches, yielding between
   * batches so a large room backlog cannot monopolize the WebView. */
  private enqueueInbound(data: ArrayBuffer | string, deliver: (data: ArrayBuffer | string) => void): void {
    this.inboundReplayQueue.push({ data, deliver });
    this.scheduleInboundReplay();
  }

  private scheduleInboundReplay(): void {
    if (this.replayScheduled) return;
    this.replayScheduled = true;
    void scheduleProgressiveSyncWork({
      id: `encrypted-frame-replay:${this.replayProviderId}`,
      lane: "P1",
      kind: "sliceable",
      maxRetries: 0,
      checkpoint: async (value) => {
        await setSyncCheckpoint({
          domain: "encrypted-frame-replay",
          cursor: String(value),
          shard: null,
        });
      },
      run: (context) => this.drainInboundReplay(context),
    })
      .catch((error) => {
        console.warn("[EncryptedWebsocketProvider] bounded replay failed", error);
      })
      .finally(() => {
        this.replayScheduled = false;
        if (this.inboundReplayQueue.length > 0) this.scheduleInboundReplay();
      });
  }

  private async drainInboundReplay(context: SyncWorkContext): Promise<void> {
    while (this.inboundReplayQueue.length > 0) {
      const batch = this.inboundReplayQueue.splice(0, 32);
      for (const entry of batch) entry.deliver(entry.data);
      this.inboundReplayFrames += batch.length;
      // The scheduler owns checkpoint persistence. This cursor is deliberately
      // diagnostic-only until resume semantics can identify a frame in the
      // relay log without changing the wire format.
      await context.checkpoint(String(this.inboundReplayFrames));
      if (this.inboundReplayQueue.length === 0) break;
      // Returning (rather than yielding in place) is what actually releases
      // the scheduler: `yield()` hands control back to the host but keeps this
      // item inside the drain loop, so looping here until the queue empties
      // starves every other lane — including the P0 boot items that bind the
      // sync domain handlers. The `.finally` in scheduleInboundReplay
      // re-enqueues us for the next slice, preserving progress.
      if (context.shouldYield()) return;
      await context.yield();
    }
  }
  // --- Lifecycle pass-throughs so callers can treat this like a provider ---

  connect(): void {
    this.provider.connect();
  }

  disconnect(): void {
    this.provider.disconnect();
  }

  destroy(): void {
    this.inboundReplayQueue.length = 0;
    this.provider.destroy();
  }

  get wsconnected(): boolean {
    return this.provider.wsconnected;
  }

  get synced(): boolean {
    return this.provider.synced;
  }

  get awareness() {
    return this.provider.awareness;
  }

  get doc(): Y.Doc {
    return this.provider.doc;
  }

  on(event: string, f: (...args: unknown[]) => void): this {
    this.provider.on(event, f as never);
    return this;
  }

  off(event: string, f: (...args: unknown[]) => void): this {
    this.provider.off(event, f as never);
    return this;
  }
}

// Internal: the message-type byte used on the wire, exported for tests and for
// other code that needs to recognize encrypted frames (e.g. a diagnostics view).
export const __encryptedSyncMessageType = MESSAGE_ENCRYPTED_SYNC;

/**
 * Build a WebSocket constructor whose `send` encrypts sync payloads and whose
 * `onmessage` delivery decrypts them. The real WebSocket (global or `ws`) does
 * the actual transport; we only rewrite the bytes in flight.
 *
 * We cannot simply wrap `onmessage` after-the-fact because y-websocket assigns
 * it internally and reads synchronously — the decrypt is async. So we buffer
 * each inbound ArrayBuffer, await decryption, and only then invoke whichever
 * `onmessage` handler y-websocket has currently installed. We track the
 * handler via a getter/setter pair so we always call the live one.
 */
type WebSocketPolyfillCtor = {
  new (url: string | URL, protocols?: string | string[]): WebSocket;
  prototype: WebSocket;
  readonly CLOSED: number;
  readonly CLOSING: number;
  readonly CONNECTING: number;
  readonly OPEN: number;
};

/**
 * Coerce a binary message payload (ArrayBuffer, TypedArray, DataView, or Node
 * Buffer) into a Uint8Array view without relying on `instanceof` — jsdom and
 * Node live in different realms so cross-realm `ArrayBuffer` checks are
 * unreliable. Returns null if `data` is not a recognizable binary value.
 */
function toUint8Array(data: unknown): Uint8Array | null {
  if (data === null || typeof data !== "object") return null;
  const obj = data as {
    buffer?: unknown;
    byteOffset?: unknown;
    byteLength?: unknown;
  };
  // TypedArray / DataView / Node Buffer: has an underlying buffer + offset.
  if (
    obj.buffer !== undefined &&
    obj.buffer !== null &&
    typeof obj.byteOffset === "number" &&
    typeof obj.byteLength === "number"
  ) {
    return new Uint8Array(
      obj.buffer as ArrayBuffer,
      obj.byteOffset,
      obj.byteLength,
    );
  }
  // Bare ArrayBuffer-like (no nested buffer): e.g. a real ArrayBuffer whose
  // realm matches. Detect by the presence of byteLength without a nested
  // buffer; coerce defensively.
  if (
    obj.buffer === undefined &&
    typeof obj.byteLength === "number"
  ) {
    try {
      return new Uint8Array(data as ArrayBuffer);
    } catch {
      return null;
    }
  }
  return null;
}

function makeEncryptingWebSocketPolyfill(
  encrypt: (data: Uint8Array) => Promise<Uint8Array>,
  decrypt: (data: Uint8Array) => Promise<Uint8Array | null>,
  enqueueInbound: (data: ArrayBuffer | string, deliver: (data: ArrayBuffer | string) => void) => void,
): WebSocketPolyfillCtor {
  const RealWebSocket = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!RealWebSocket) {
    throw new Error(
      "EncryptedWebsocketProvider: no global WebSocket available for polyfill",
    );
  }

  // Cap on concurrent in-flight inbound decrypt operations. Bounds how many
  // decrypted buffers can be alive at once when frames arrive faster than
  // they can be projected (task 0.4) — a stand-in for pause/resume, since a
  // browser WebSocket has no true flow-control hook.
  const MAX_INBOUND_PENDING = 64;

  // tslint:disable-next-line max-classes-per-file
  class EncryptingWebSocket {
    private real: WebSocket;
    private messageHandler: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
    // Outbound encrypt+send is serialized through this promise chain instead
    // of fire-and-forget, so only one ciphertext buffer is ever in flight.
    private outboundQueue: Promise<void> = Promise.resolve();
    private inboundPending = 0;
    private inboundWaiters: Array<() => void> = [];

    static readonly CONNECTING = 0 as const;
    static readonly OPEN = 1 as const;
    static readonly CLOSING = 2 as const;
    static readonly CLOSED = 3 as const;
    readonly CONNECTING = 0 as const;
    readonly OPEN = 1 as const;
    readonly CLOSING = 2 as const;
    readonly CLOSED = 3 as const;

    onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
    onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
    onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
    binaryType: BinaryType = "arraybuffer";

    constructor(url: string | URL, protocols?: string | string[]) {
      this.real = new RealWebSocket(url, protocols);
      this.real.binaryType = "arraybuffer";

      this.real.onopen = (ev) => {
        if (this.onopen) this.onopen.call(this as unknown as WebSocket, ev);
      };
      this.real.onclose = (ev) => {
        if (this.onclose) this.onclose.call(this as unknown as WebSocket, ev);
      };
      this.real.onerror = (ev) => {
        if (this.onerror) this.onerror.call(this as unknown as WebSocket, ev);
      };
      this.real.onmessage = (ev) => {
        const data = (ev as MessageEvent).data;
        // y-websocket only ever uses binary frames. Coerce ArrayBuffer,
        // ArrayBufferView, and Node Buffer (from the `ws` polyfill) all into a
        // Uint8Array view. String frames are passed through verbatim. We avoid
        // `instanceof ArrayBuffer` / `ArrayBuffer.isView` here because jsdom
        // and Node run in different realms: a Buffer from `ws` may not satisfy
        // either check against the jsdom ArrayBuffer global.
        if (typeof data === "string") {
          enqueueInbound(data, (queued) => this.deliver(queued));
          return;
        }
        const bytes = toUint8Array(data);
        if (bytes === null) {
          console.error(
            "[EncryptedWebsocketProvider] unrecognized inbound frame shape",
            typeof data,
          );
          return;
        }
        void this.handleInboundBinary(bytes, enqueueInbound);
      };
    }

    private async handleInboundBinary(
      bytes: Uint8Array,
      enqueueInbound: (data: ArrayBuffer | string, deliver: (data: ArrayBuffer | string) => void) => void,
    ): Promise<void> {
      await this.acquireInboundSlot();
      try {
        const decrypted = await decrypt(bytes);
        if (decrypted === null) return;
        enqueueInbound(decrypted.buffer, (queued) => this.deliver(queued));
      } catch (err) {
        console.error(
          "[EncryptedWebsocketProvider] inbound decrypt pipeline failed",
          err,
        );
      } finally {
        this.releaseInboundSlot();
      }
    }

    /** Resolves immediately while under MAX_INBOUND_PENDING; otherwise waits
     * for a slot to free up (backpressure). */
    private acquireInboundSlot(): Promise<void> {
      if (this.inboundPending < MAX_INBOUND_PENDING) {
        this.inboundPending++;
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        this.inboundWaiters.push(() => {
          this.inboundPending++;
          resolve();
        });
      });
    }

    private releaseInboundSlot(): void {
      this.inboundPending--;
      const next = this.inboundWaiters.shift();
      if (next) next();
    }

    private deliver(data: ArrayBuffer | string): void {
      if (!this.messageHandler) return;
      const ev = new MessageEvent("message", { data });
      this.messageHandler.call(this as unknown as WebSocket, ev);
    }

    get url(): string {
      return this.real.url;
    }
    get readyState(): number {
      return this.real.readyState;
    }
    get bufferedAmount(): number {
      return this.real.bufferedAmount;
    }
    get extensions(): string {
      return this.real.extensions;
    }
    get protocol(): string {
      return this.real.protocol;
    }

    set onmessage(
      handler: ((this: WebSocket, ev: MessageEvent) => unknown) | null,
    ) {
      this.messageHandler = handler;
    }
    get onmessage(): ((this: WebSocket, ev: MessageEvent) => unknown) | null {
      return this.messageHandler;
    }

    send(data: string | ArrayBuffer | ArrayBufferView): void {
      if (typeof data === "string") {
        this.real.send(data);
        return;
      }
      let bytes: Uint8Array;
      if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
      } else {
        // ArrayBufferView
        bytes = new Uint8Array(
          (data as ArrayBufferView).buffer,
          (data as ArrayBufferView).byteOffset,
          (data as ArrayBufferView).byteLength,
        );
      }
      // Chain onto the outbound queue rather than firing independently, so
      // encrypt+send happens one buffer at a time in send order (task 0.4).
      this.outboundQueue = this.outboundQueue
        .then(() => encrypt(bytes))
        .then((ciphertext) => {
          if (this.real.readyState === RealWebSocket.OPEN) {
            this.real.send(ciphertext);
          }
        })
        .catch((err) => {
          console.error(
            "[EncryptedWebsocketProvider] outbound encrypt pipeline failed",
            err,
          );
        });
    }

    close(code?: number, reason?: string): void {
      this.real.close(code, reason);
    }

    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void {
      // Route message listeners through our handler bookkeeping so decrypt runs
      // before they fire. open/close/error pass straight through.
      if (type === "message") {
        const fn = listener as (
          this: WebSocket,
          ev: MessageEvent,
        ) => unknown;
        this.messageHandler = fn as (
          this: WebSocket,
          ev: MessageEvent,
        ) => unknown;
        return;
      }
      this.real.addEventListener(type, listener, options);
    }

    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ): void {
      if (type === "message") {
        this.messageHandler = null;
        return;
      }
      this.real.removeEventListener(type, listener, options);
    }

    dispatchEvent(event: Event): boolean {
      return this.real.dispatchEvent(event);
    }
  }

  return EncryptingWebSocket as unknown as WebSocketPolyfillCtor;
}
