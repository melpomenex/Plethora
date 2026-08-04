import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import * as React from "react";

/**
 * SyncQrScanner no-silent-failure contract.
 *
 * Background: the QR scan-to-join flow on mobile had the symptom "camera opens,
 * I point it at the code, nothing happens." Two independent silent failures
 * caused it:
 *   1. A rejected payload (onDetected returning false) set NO error state, so
 *      the camera stayed open with zero feedback.
 *   2. The qr-scanner library's default `onDecodeError` only console.log's
 *      engine errors, so a dead decode loop (blocked worker, dead
 *      requestVideoFrameCallback, etc.) was invisible.
 *
 * These tests lock in that every failure path now surfaces a visible message.
 */

// Captured constructor invocations from the mocked QrScanner.
type Captured = {
  onDecode: (result: { data: string }) => void | Promise<void>;
  onDecodeError?: (error: Error | string) => void;
  options: Record<string, unknown>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};
let captured: Captured | null = null;

// vi.hoisted runs before vi.mock factories (which are themselves hoisted), so
// the constant is initialized in time for the factory below to reference it.
const { NO_QR_CODE_FOUND } = vi.hoisted(() => ({
  NO_QR_CODE_FOUND: "No QR code found",
}));

vi.mock("qr-scanner", () => {
  return {
    default: class FakeQrScanner {
      static NO_QR_CODE_FOUND = NO_QR_CODE_FOUND;
      constructor(
        _video: HTMLVideoElement,
        onDecode: Captured["onDecode"],
        optionsOrOnDecodeError?: Captured["onDecodeError"] | Record<string, unknown>,
        _maybeMore?: unknown,
      ) {
        // qr-scanner supports both the options-object form (which we use) and
        // the deprecated positional onDecodeError form. Handle both so the test
        // is robust to the library's overloads.
        const isOptionsObject =
          typeof optionsOrOnDecodeError === "object" && optionsOrOnDecodeError !== null;
        const options = isOptionsObject
          ? (optionsOrOnDecodeError as Record<string, unknown>)
          : {};
        const onDecodeError = isOptionsObject
          ? (options.onDecodeError as Captured["onDecodeError"] | undefined)
          : (optionsOrOnDecodeError as Captured["onDecodeError"] | undefined);
        const start = vi.fn().mockResolvedValue(undefined);
        const stop = vi.fn().mockResolvedValue(undefined);
        const destroy = vi.fn();
        captured = { onDecode, onDecodeError, options, start, stop, destroy };
        this._start = start;
        this._stop = stop;
        this._destroy = destroy;
      }
      _start: () => Promise<void>;
      _stop: () => Promise<void>;
      _destroy: () => void;
      async start() {
        return this._start();
      }
      async stop() {
        return this._stop();
      }
      destroy() {
        return this._destroy();
      }
    },
  };
});

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    // Echo the key so assertions can match on the i18n key string.
    t: (k: string) => k,
  }),
}));

import { SyncQrScanner } from "../SyncQrScanner";

beforeEach(() => {
  captured = null;
});

async function renderScanner(props: {
  onDetected: (v: string) => boolean | Promise<boolean>;
  onClose?: () => void;
}) {
  const onClose = props.onClose ?? vi.fn();
  render(
    React.createElement(SyncQrScanner, {
      onDetected: props.onDetected,
      onClose,
    }),
  );
  await waitFor(() => expect(captured).not.toBeNull());
  return { onClose };
}

describe("SyncQrScanner failure surfacing", () => {
  it("passes an onDecodeError handler so engine errors are not swallowed", async () => {
    // Regression guard for Bug 2: previously no onDecodeError was supplied, so
    // the library's default (console.log only) hid every engine error.
    await renderScanner({ onDetected: async () => true });

    expect(captured).not.toBeNull();
    expect(typeof captured!.onDecodeError).toBe("function");
  });

  it("surfaces a visible error when the decode engine reports a non-'no code' error", async () => {
    await renderScanner({ onDetected: async () => true });

    // Simulate the worker/engine throwing on every frame (e.g. Blob worker
    // blocked by CSP, requestVideoFrameCallback dead on the WebView).
    act(() => {
      captured!.onDecodeError!(new Error("Worker construction failed"));
    });

    expect(screen.getByText("settings.syncQrDecodeError")).toBeInTheDocument();
  });

  it("does NOT surface the normal 'no QR code found' per-frame result", async () => {
    await renderScanner({ onDetected: async () => true });

    act(() => {
      captured!.onDecodeError!(NO_QR_CODE_FOUND);
    });

    expect(screen.queryByText("settings.syncQrDecodeError")).toBeNull();
  });

  it("surfaces the rejection reason when onDetected throws (caller-visible why)", async () => {
    // Regression guard for Bug 1: a rejected payload previously set no error,
    // leaving the camera open with zero feedback. Now the caller throws the
    // reason and we render it inline.
    await renderScanner({
      onDetected: async () => {
        throw new Error("That isn't a valid sync code.");
      },
    });

    act(() => {
      captured!.onDecode({ data: "garbage" });
    });

    await waitFor(() => {
      expect(screen.getByText("That isn't a valid sync code.")).toBeInTheDocument();
    });
  });

  it("closes the scanner when onDetected resolves true (success unchanged)", async () => {
    const onClose = vi.fn();
    await renderScanner({ onDetected: async () => true, onClose });

    await act(async () => {
      await captured!.onDecode({ data: "incrementum-sync:v1:room:secret" });
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the scanner open when onDetected resolves false (bare rejection)", async () => {
    const onClose = vi.fn();
    await renderScanner({ onDetected: async () => false, onClose });

    await act(async () => {
      await captured!.onDecode({ data: "anything" });
    });

    // A bare false (no throw) is the intentionally-quiet path: the scanner
    // stays open for re-scan and onClose is NOT called.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders the camera-failed message when start() rejects", async () => {
    // Simulate a hard camera failure (e.g. permission denied -> NotAllowedError).
    // We patch the mocked prototype's start() to reject for this test only.
    const QrScannerModule = (await import("qr-scanner")).default as {
      prototype: { start: () => Promise<void> };
    };
    const originalStart = QrScannerModule.prototype.start;
    QrScannerModule.prototype.start = vi
      .fn()
      .mockRejectedValue(new Error("NotAllowedError")) as unknown as () => Promise<void>;

    try {
      render(
        React.createElement(SyncQrScanner, {
          onDetected: async () => true,
          onClose: () => {},
        }),
      );
      // setError(err.message) renders the rejected message inline.
      await waitFor(() => {
        expect(screen.getByText("NotAllowedError")).toBeInTheDocument();
      });
    } finally {
      QrScannerModule.prototype.start = originalStart;
    }
  });
});
