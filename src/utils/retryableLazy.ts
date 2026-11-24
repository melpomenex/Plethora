import { createElement, lazy, type ComponentType } from "react";
import { importWithRetry } from "./importWithRetry";

export type RetryableLazyComponent<T extends ComponentType<any> = ComponentType<any>> =
  T & {
    preload: () => Promise<void>;
  };

/**
 * Wrap a dynamic component import with timeout + retry (`importWithRetry`),
 * synchronous rendering once resolved, and reset-on-failure so `Retry`
 * genuinely re-attempts the import instead of re-throwing a cached
 * `React.lazy` rejection.
 *
 * Calling `preload()` warms the exact same resolved-component cache and shares
 * any in-flight promise with the rendered component, so prefetched views mount
 * synchronously without re-suspending on first visit.
 */
export function createRetryableLazy<T extends ComponentType<any>>(
  name: string,
  loader: () => Promise<{ default: T }>,
  options: { logPrefix?: string; timeoutMs?: number; retries?: number } = {}
): RetryableLazyComponent<T> {
  const { logPrefix = "[lazy]", timeoutMs, retries } = options;
  let resolvedComponent: T | null = null;
  let inFlight: Promise<{ default: T }> | null = null;
  let cachedLazy: ComponentType<any> | null = null;
  let lastFailed = false;

  const loadOnce = (): Promise<{ default: T }> => {
    if (resolvedComponent) {
      return Promise.resolve({ default: resolvedComponent });
    }
    if (inFlight) {
      return inFlight;
    }

    inFlight = importWithRetry(name, loader, { timeoutMs, retries })
      .then((mod) => {
        resolvedComponent = mod.default;
        inFlight = null;
        lastFailed = false;
        return mod;
      })
      .catch((err) => {
        inFlight = null;
        // Defer marking `lastFailed` to the next macrotask so React's
        // synchronous error-boundary recovery re-renders hit the same
        // rejected `React.lazy` instance instead of re-invoking `loader()`.
        setTimeout(() => {
          lastFailed = true;
        }, 0);
        console.error(`${logPrefix} Failed to lazy-load "${name}":`, err);
        throw err;
      });

    return inFlight;
  };

  function RetryableLazy(props: Record<string, unknown>) {
    if (resolvedComponent) {
      return createElement(resolvedComponent, props);
    }
    if (!cachedLazy || lastFailed) {
      lastFailed = false;
      cachedLazy = lazy(loadOnce);
    }
    return createElement(cachedLazy, props);
  }

  RetryableLazy.displayName = `RetryableLazy(${name})`;
  RetryableLazy.preload = (): Promise<void> => loadOnce().then(() => undefined, () => undefined);

  return RetryableLazy as unknown as RetryableLazyComponent<T>;
}
