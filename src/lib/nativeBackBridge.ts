import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { reserveNavigationRoot, resumeNavigationMutations } from "./navigationRootReservation";
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

export const productionNativeBackTransport: NativeBackTransport = {
  listen: (handler) => addPluginListener<NativeBackRequest>(PLUGIN, "back-request", handler),
  listenControl: (handler) => addPluginListener(PLUGIN, "back-control", handler),
  attach: (clientSessionId) => invoke<NativeBackSession>(`plugin:${PLUGIN}|attach`, { clientSessionId }),
  claim: (epoch, id) => invoke<NativeBackClaim>(`plugin:${PLUGIN}|claim`, { epoch, id }),
  acknowledge: (epoch, id, result) => invoke(`plugin:${PLUGIN}|acknowledge`, {
    args: {
      epoch,
      id,
      kind: result.kind,
      ...(result.kind === "consumed" ? { outcome: result.outcome, transitionId: result.transitionId } : {}),
    },
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
  const transport = options.transport ?? productionNativeBackTransport;
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
  let foregroundSignalPending = false;

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
    let result: BackDispatch;
    try { result = dispatch(request); }
    catch { result = { kind: "unavailable" }; }
    const release = result.kind === "root" ? reserveNavigationRoot() : null;
    if (release) releaseRoot = release;
    try {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const acknowledgment = await Promise.race([
        transport.acknowledge(request.epoch, request.id, result),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("ack-timeout")), Math.min(remaining, wallRemaining));
        }),
      ]).finally(() => { if (timeout) clearTimeout(timeout); });
      const accepted = acknowledgment as { accepted?: boolean; backgrounded?: boolean } | undefined;
      if (accepted?.accepted === false) report("ack-rejected");
      release?.(accepted?.accepted === true && accepted.backgrounded === true);
    } catch {
      report("ack-failed; request-not-replayed");
      release?.();
    } finally {
      if (releaseRoot === release) releaseRoot = null;
    }

  };

  let registration: Promise<void> | null = null;
  let diagnosticAt = -Infinity;
  let releaseRoot: ((didBackground?: boolean) => void) | null = null;
  const report = (stage: string) => {
    if (now() - diagnosticAt < 1000) return;
    diagnosticAt = now();
    console.warn(`[native-back] ${stage}`);
  };
  const invalidate = () => {
    ++attachRevision;
    const previous = epoch;
    epoch = null;
    releaseRoot?.();
    releaseRoot = null;
    if (previous) void transport.detach(previous).catch(() => report("detach-failed"));
  };
  const ensureListeners = () => {
    if (registration) return registration;
    registration = (async () => {
      const next = await transport.listen((request) => { void handleRequest(request); });
      if (disposed) { await next.unregister(); return; }
      listener = next;
      if (transport.listenControl) {
        try {
          const control = await transport.listenControl((event) => {
            if (event?.type !== "retry" && event?.type !== "session-invalidated") return;
            invalidate();
            if (isVisible()) void attach();
          });
          if (disposed) { await control.unregister(); return; }
          controlListener = control;
        } catch (error) {
          await next.unregister();
          listener = null;
          throw error;
        }
      }
    })().catch(() => {
      registration = null;
      throw new Error("listener-registration-failed");
    });
    return registration;
  };
  const attach = async () => {
    if (attachInFlight) { foregroundSignalPending = true; return; }
    if (disposed || epoch || !isVisible()) return;
    foregroundSignalPending = false;
    attachInFlight = true;
    const revision = ++attachRevision;
    try {
      await ensureListeners();
      if (disposed || revision !== attachRevision || !isVisible()) return;
      const session = await transport.attach(clientSessionId());
      if (disposed || revision !== attachRevision || !isVisible()) {
        if (session?.epoch) await transport.detach(session.epoch);
        return;
      }
      if (session?.protocolVersion !== PROTOCOL_VERSION || typeof session.epoch !== "string" || !session.epoch) {
        if (session?.epoch) await transport.detach(session.epoch);
        report("invalid-session");
        return;
      }
      epoch = session.epoch;
      seen.clear();
      seenOrder.splice(0);
    } catch {
      epoch = null;
      report("attach-failed; retry-on-resume-or-focus");
    } finally {
      attachInFlight = false;
      // A lifecycle invalidation while attach was resolving needs a fresh
      // handshake; ordinary failures wait for a new foreground signal.
      if (!disposed && (revision !== attachRevision || foregroundSignalPending) && isVisible()) void attach();
    }
  };

  const handleVisibility = () => {
    if (isVisible()) { resumeNavigationMutations(); void attach(); }
    else invalidate();
  };
  const handleRetry = () => {
    options.onRecoveryRetry?.();
    invalidate();
    void attach();
  };

  // Listener registration is started first; attach awaits it before creating
  // the native session so no early Back request can be lost.
  void attach();
  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("plethora:native-back-retry", handleRetry);
  window.addEventListener("focus", handleVisibility);
  window.addEventListener("pageshow", handleVisibility);

  return () => {
    disposed = true;
    attachRevision++;
    document.removeEventListener("visibilitychange", handleVisibility);
    window.removeEventListener("plethora:native-back-retry", handleRetry);
    window.removeEventListener("focus", handleVisibility);
    window.removeEventListener("pageshow", handleVisibility);
    releaseRoot?.();
    resumeNavigationMutations();
    const currentEpoch = epoch;
    epoch = null;
    if (currentEpoch) void transport.detach(currentEpoch).catch(() => undefined);
    if (listener) void listener.unregister().catch(() => undefined);
    if (controlListener) void controlListener.unregister().catch(() => undefined);
  };
}
