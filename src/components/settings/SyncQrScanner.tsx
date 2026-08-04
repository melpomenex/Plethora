import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { useI18n } from "../../lib/i18n";

// qr-scanner's per-frame decode invokes onDecodeError with NO_QR_CODE_FOUND
// whenever a frame simply contained no QR code — the overwhelmingly common
// case while aiming, which must NOT be surfaced (it would flash on every empty
// frame). Anything else means the decode engine itself is failing (worker
// blocked, Blob worker refused by CSP, requestVideoFrameCallback never firing,
// etc.). Without surfacing those, the camera plays forever with zero feedback
// — the exact "I point it at the code and nothing happens" symptom.
const NO_QR_CODE_FOUND = QrScanner.NO_QR_CODE_FOUND;

type SyncQrScannerProps = {
  /**
   * Called with each decoded value. May be async. Return `true` to accept and
   * close the scanner; return `false` (or throw) to REJECT and keep scanning —
   * e.g. when the scanned payload is not a valid sync code, so the user can
   * re-aim at the right QR without re-opening the camera. Throw an Error to
   * also surface its `.message` inline as the `error`.
   */
  onDetected: (value: string) => boolean | Promise<boolean>;
  onClose: () => void;
};

export function SyncQrScanner({ onDetected, onClose }: SyncQrScannerProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // useRef rather than state so the QrScanner callback (captured once on mount)
  // always reads the latest onDetected/onClose/t without re-creating the scanner.
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    let scanner: QrScanner | null = null;
    let cancelled = false;
    // The decode engine fires onDecodeError on every frame it can't process.
    // "No QR code found" is the normal aiming case and is filtered out below;
    // any OTHER error indicates the engine itself is broken (worker refused,
    // Blob blocked, rVFC dead). Debounce by message so a steady stream of the
    // same engine error doesn't re-render the banner every frame.
    let lastEngineError = "";

    const start = async () => {
      if (!videoRef.current) {
        return;
      }

      try {
        scanner = new QrScanner(
          videoRef.current,
          async (result) => {
            setError(null);
            try {
              const accepted = await onDetectedRef.current(result.data);
              if (accepted) {
                onCloseRef.current();
              }
              // If not accepted, the scanner keeps running so the user can
              // re-scan. The caller surfaces why by throwing (→ we set
              // `error` below); a bare `false` return is intentionally silent
              // for callers that prefer to keep the scanner quiet.
            } catch (err) {
              const msg = err instanceof Error ? err.message : tRef.current("settings.syncQrInvalidCode");
              setError(msg);
            }
          },
          {
            returnDetailedScanResult: true,
            highlightScanRegion: true,
            highlightCodeOutline: true,
            preferredCamera: "environment",
            // CRITICAL: without this, the library's default onDecodeError only
            // console.log's engine errors. On Android those vanish from view,
            // so a dead decode loop looks identical to "just hasn't seen a QR
            // yet" — the user points at the code forever and nothing happens.
            onDecodeError: (error) => {
              const msg = typeof error === "string" ? error : error.message;
              if (!msg || msg === NO_QR_CODE_FOUND) return;
              if (msg === lastEngineError) return;
              lastEngineError = msg;
              console.warn("[SyncQrScanner] decode engine error", error);
              setError(tRef.current("settings.syncQrDecodeError"));
            },
          }
        );

        await scanner.start();
        // Guard against a teardown that raced ahead while start() was awaiting
        // camera permission + MediaStream setup. Without this, the cleanup's
        // stop()/destroy() runs, then the resolved promise continues with a
        // "ghost" scanner whose video has already been torn down — the next
        // play() throws "play() request was interrupted by pause()".
        if (cancelled) {
          scanner.stop();
          scanner.destroy();
          scanner = null;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : tRef.current("settings.syncQrCameraFailed"));
        }
      }
    };

    start();

    return () => {
      cancelled = true;
      scanner?.stop();
      scanner?.destroy();
      scanner = null;
    };
    // Empty deps: the scanner is created once on mount and destroyed on unmount.
    // Callbacks and t are read via refs so identity changes don't re-run this
    // effect (which previously raced teardown against start() and caused the
    // "play() interrupted by pause()" error on first open — see useI18n, which
    // returns a fresh `t` function each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-lg bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium text-foreground">{t("settings.syncQrScanCode")}</div>
          <button
            onClick={onClose}
            className="rounded bg-muted px-2 py-1 text-xs text-foreground"
          >
            {t("common.close")}
          </button>
        </div>
        {error && (
          <div className="mb-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        )}
        <video
          ref={videoRef}
          className="aspect-square w-full rounded border border-border bg-black"
          muted
          playsInline
        />
        <div className="mt-2 text-xs text-muted-foreground">
          {t("settings.syncQrInstruction")}
        </div>
      </div>
    </div>
  );
}
