/**
 * Timeout + retry wrapper for dynamic imports.
 *
 * On the Android WebView the first fetch of a lazily-loaded JS chunk can
 * stall indefinitely (asset-protocol hiccup). React.lazy holds that single
 * pending promise forever, which surfaces as a view that "spins loading" on
 * first open and works after back + re-tap — the re-tap issues a fresh
 * import() and a fresh fetch. Racing the import against a timeout and
 * retrying self-heals the stall in place instead of requiring the user to
 * discover the workaround.
 *
 * A successfully loaded module is cached by the ESM loader, so retries only
 * ever re-fetch chunks that never arrived.
 */
import { firstViewChunkEnd, firstViewChunkFailed, firstViewChunkStart } from "./firstViewDiagnostics";

export async function importWithRetry<T>(
  name: string,
  loader: () => Promise<T>,
  options: { timeoutMs?: number; retries?: number } = {}
): Promise<T> {
  const { timeoutMs = 15_000, retries = 2 } = options;
  let lastError: unknown = new Error(`chunk load failed: ${name}`);

  // Development-only instrumentation: cold chunk-fetch latency is the dominant
  // term in first-open stalls, and warm repeats must stay fast (see
  // firstViewDiagnostics.ts).
  firstViewChunkStart(name);

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      });
      const result = await Promise.race([loader(), timeout]);
      firstViewChunkEnd(name);
      return result;
    } catch (error) {
      lastError = error;
      console.error(
        `[lazy] "${name}" load attempt ${attempt}/${retries + 1} failed:`,
        error
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  firstViewChunkFailed(name);
  throw lastError;
}
