/**
 * Web Worker for Argon2id key derivation.
 *
 * Moved off the main thread because hash-wasm's argon2id WASM blocks
 * JavaScript execution for several seconds (64 MiB memory × 3 iterations
 * × 4 parallelism). Running it here keeps the UI interactive during
 * first-boot key provisioning.
 *
 * Communication protocol:
 *   - Receives { secret: string, roomId: string } (via postMessage)
 *   - Posts back { key: Uint8Array } on success
 *   - Posts back { error: string } on failure
 */

/// <reference lib="webworker" />

// hash-wasm lazily compiles its WASM module on first call. That compilation
// also happens in the worker (off the main thread), so the main thread
// stays responsive during both compilation and computation.
import { argon2id } from "hash-wasm";

self.onmessage = async (event: MessageEvent<{ secret: string; roomId: string }>) => {
  const { secret, roomId } = event.data;

  try {
    const salt = new TextEncoder().encode(`incrementum-sync/${roomId}`);
    const passwordBytes = new TextEncoder().encode(secret);

    const key = await argon2id({
      password: passwordBytes,
      salt,
      parallelism: 4,
      memorySize: 65536, // 64 MiB
      iterations: 3,
      hashLength: 32,
      outputType: "binary",
    });

    self.postMessage({ key }, { transfer: [key.buffer] });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    self.postMessage({ error: message });
  }
};
