/**
 * Authoritative in-memory microphone ownership coordinator.
 *
 * Enforces single microphone ownership across dictation, session recording,
 * and mobile native speech services. A busy owner is never displaced.
 */

export interface CaptureOwnerDetails {
  owner?: string;
  sessionId?: string;
  epoch?: string;
}

export interface ActiveCaptureLease {
  owner: string;
  sessionId?: string;
  epoch?: string;
  token: symbol;
  acquiredAt: number;
}

let activeLease: ActiveCaptureLease | null = null;

/** Returns true if another owner currently holds the microphone lease. */
export function isAudioCaptureBusy(): boolean {
  return activeLease !== null;
}

/** Returns the current active microphone lease metadata, or null if idle. */
export function getCurrentCaptureOwner(): ActiveCaptureLease | null {
  return activeLease ? { ...activeLease } : null;
}

/**
 * Shared microphone lease coordinator across dictation and session recording.
 * A busy owner is never stopped implicitly.
 *
 * @throws Error starting with "busy:" if another owner already holds the lease.
 * @returns Idempotent release function.
 */
export function acquireAudioCapture(details?: CaptureOwnerDetails): () => void {
  if (activeLease !== null) {
    const currentOwner = activeLease.owner;
    throw new Error(
      `busy: Another microphone session is active (${currentOwner}). Stop it before dictating.`
    );
  }

  const token = Symbol("audio-capture");
  const lease: ActiveCaptureLease = {
    owner: details?.owner ?? "capture",
    sessionId: details?.sessionId,
    epoch: details?.epoch,
    token,
    acquiredAt: Date.now(),
  };
  activeLease = lease;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (activeLease?.token === token) {
      activeLease = null;
    }
  };
}

/** Reset active capture lease state (strictly for testing). */
export function resetCaptureOwnerForTesting(): void {
  activeLease = null;
}
