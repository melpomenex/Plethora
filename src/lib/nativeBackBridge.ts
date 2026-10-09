import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { dispatchApplicationBack, type BackDispatch } from "./applicationBack";

const PLUGIN = "plethora-navigation";
const PROTOCOL_VERSION = 1;
const REQUEST_LIMIT = 256;

export interface NativeBackRequest {
  protocolVersion: number;
  epoch: string;
  sequence: number;
  id: string;
}

export interface NativeBackClaim {
  accepted: boolean;
  remainingMs: number;
  expiresAtEpochMs: number;
}

export interface NativeBackSession {
  protocolVersion: number;
  epoch: string;
}

export interface NativeBackTransport {
  listen(handler: (request: NativeBackRequest) => void): Promise<{ unregister(): Promise<void> }>;
  listenControl?(handler: (event: { type: "retry" | "session-invalidated" }) => void): Promise<{ unregister(): Promise<void> }>;
  attach(clientSessionId: string): Promise<NativeBackSession>;
  claim(epoch: string, id: string): Promise<NativeBackClaim>;
  acknowledge(epoch: string, id: string, result: BackDispatch): Promise<unknown>;
  detach(epoch: string): Promise<unknown>;
}

export interface NativeBackBridgeOptions {
  transport?: NativeBackTransport;
  dispatch?: (request: NativeBackRequest) => BackDispatch;
  isVisible?: () => boolean;
  now?: () => number;
  wallNow?: () => number;
  clientSessionId?: () => string;
  onRecoveryRetry?: () => void;
}

const productionTransport: NativeBackTransport = {
  listen: (handler) => addPluginListener<NativeBackRequest>(PLUGIN, "back-request", handler),
  listenControl: (handler) => addPluginListener(PLUGIN, "back-control", handler),
  attach: (clientSessionId) => invoke<NativeBackSession>(`plugin:${PLUGIN}|attach`, { clientSessionId }),
  claim: (epoch, id) => invoke<NativeBackClaim>(`plugin:${PLUGIN}|claim`, { epoch, id }),
  acknowledge: (epoch, id, result) => invoke(`plugin:${PLUGIN}|acknowledge`, {
    epoch,
    id,
    kind: result.kind,
    ...(result.kind === "consumed" ? { outcome: result.outcome, transitionId: result.transitionId } : {}),
  }),
  detach: (epoch) => invoke(`plugin:${PLUGIN}|detach`, { epoch }),
};

function validRequest(value: NativeBackRequest): boolean {
  return value?.protocolVersion === PROTOCOL_VERSION &&
    typeof value.epoch === "string" && value.epoch.length > 0 && value.epoch.length <= 128 &&
    Number.isSafeInteger(value.sequence) && value.sequence > 0 &&
    typeof value.id === "string" && value.id.length > 0 && value.id.length <= 128;
}

/**
 * Installs the listener before attaching the native session. Each request is
 * claimed and synchronously dispatched at most once; an ACK failure never
 * causes navigation to be replayed.
 */
export function startNativeBackBridge(options: NativeBackBridgeOptions = {}): () => void {
  const transport = options.transport ?? productionTransport;
  const dispatch = options.dispatch ?? ((request) => dispatchApplicationBack({
    source: "android-system",
    id: request.id,
  }));
  const isVisible = options.isVisible ?? (() => document.visibilityState !== "hidden");
  const now = options.now ?? (() => performance.now());
  const wallNow = options.wallNow ?? Date.now;
  const clientSessionId = options.clientSessionId ?? (() => crypto.randomUUID());
  const seen = new Set<string>();
  const seenOrder: string[] = [];
  let disposed = false;
  let epoch: string | null = null;
  let listener: { unregister(): Promise<void> } | null = null;
  let controlListener: { unregister(): Promise<void> } | null = null;
  let attachRevision = 0;
  let attachInFlight = false;

  const remember = (id: string) => {
    if (seen.has(id)) return false;
    seen.add(id);
    seenOrder.push(id);
    if (seenOrder.length > REQUEST_LIMIT) {
      const expired = seenOrder.shift();
      if (expired) seen.delete(expired);
    }
    return true;
  };

  const handleRequest = async (request: NativeBackRequest) => {
    if (disposed || !epoch || !validRequest(request) || request.epoch !== epoch || !remember(request.id)) return;
    const receiptMono = now();
    const receiptWall = wallNow();
    let claim: NativeBackClaim;
    try {
      claim = await transport.claim(request.epoch, request.id);
    } catch {
      return;
    }
    if (disposed || request.epoch !== epoch || !claim?.accepted || !isVisible()) return;
    const remaining = claim.remainingMs;
    const wallRemaining = claim.expiresAtEpochMs - wallNow();
    const elapsedMono = now() - receiptMono;
    const elapsedWall = wallNow() - receiptWall;
    if (!Number.isFinite(remaining) || remaining <= 0 || !Number.isFinite(wallRemaining) || wallRemaining <= 0) return;
    if (!Number.isFinite(elapsedMono) || !Number.isFinite(elapsedWall) || Math.abs(elapsedWall - elapsedMono) > 100) return;

    // No await between an accepted claim and the coordinator call.
    const result = dispatch(request);
    try {
      await transport.acknowledge(request.epoch, request.id, result);
    } catch {
      // The request journal is retained. An uncertain ACK is never replayed.
    }
  };

  const registerListener = transport.listen((request) => { void handleRequest(request); });
  const registerControl = transport.listenControl?.((event) => {
    if (event?.type !== "retry" && event?.type !== "session-invalidated") return;
    epoch = null;
    if (isVisible()) void attach();
  });
  const attach = async () => {
    if (disposed || epoch || attachInFlight) return;
    attachInFlight = true;
    const revision = ++attachRevision;
    try {
      [listener, controlListener] = await Promise.all([
        registerListener,
        registerControl ?? Promise.resolve(null),
      ]);
      if (disposed || revision !== attachRevision) {
        await listener.unregister();
        return;
      }
      const session = await transport.attach(clientSessionId());
      if (disposed || revision !== attachRevision) {
        if (session?.epoch) await transport.detach(session.epoch);
        return;
      }
      if (session?.protocolVersion === PROTOCOL_VERSION && typeof session.epoch === "string" && session.epoch.length > 0) {
        epoch = session.epoch;
      }
    } catch {
      // Retry only on a new visibility/resume signal; never poll or replay.
      epoch = null;
    } finally {
      attachInFlight = false;
    }
  };

  const handleVisibility = () => {
    if (document.visibilityState === "visible") void attach();
  };
  const handleRetry = () => {
    options.onRecoveryRetry?.();
    void attach();
  };

  // Listener registration is started first; attach awaits it before creating
  // the native session so no early Back request can be lost.
  void attach();
  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("plethora:native-back-retry", handleRetry);

  return () => {
    disposed = true;
    attachRevision++;
    document.removeEventListener("visibilitychange", handleVisibility);
    window.removeEventListener("plethora:native-back-retry", handleRetry);
    const currentEpoch = epoch;
    epoch = null;
    if (currentEpoch) void transport.detach(currentEpoch).catch(() => undefined);
    if (listener) void listener.unregister().catch(() => undefined);
    if (controlListener) void controlListener.unregister().catch(() => undefined);
  };
}
