import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { useI18n } from "../../lib/i18n";

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
              // re-scan. The caller is responsible for surfacing why (via
              // throw → we set `error` below, or its own UI).
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
