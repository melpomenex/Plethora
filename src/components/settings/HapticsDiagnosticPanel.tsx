import { useEffect, useState } from "react";
import { emitInteractionFeedback } from "../../lib/feedback/orchestrator";
import { getHapticDiagnostics, subscribeHapticDiagnostics } from "../../lib/feedback/haptics/diagnostics";
import type { HapticsSnapshot } from "../../lib/feedback/haptics/service";

/** Mounted only in development or explicitly flagged internal builds. */
export function HapticsDiagnosticPanel({ status }: { status: HapticsSnapshot }) {
  const [diagnostics, setDiagnostics] = useState(() => getHapticDiagnostics());
  useEffect(() => subscribeHapticDiagnostics(() => setDiagnostics(getHapticDiagnostics())), []);
  const testCurrentIntensity = () => emitInteractionFeedback("diagnostic.haptic-smoke-test", {}, {
    interactionId: `haptic-smoke:${crypto.randomUUID()}`, origin: "user",
  });
  return (
    <details className="rounded-md border border-border p-3 text-xs">
      <summary>Native haptics diagnostic (internal build)</summary>
      <p className="my-2">Select Subtle, Standard and Strong above, then test each level. Submitted means the platform accepted the effect; confirm whether you felt it on the phone.</p>
      <button type="button" className="rounded-md border border-border px-3 py-2" onClick={testCurrentIntensity}>
        Test native haptic ({status.intensity})
      </button>
      <pre aria-live="polite" className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">
        {JSON.stringify({ configured: status.configured, enabled: status.enabled, intensity: status.intensity,
          capabilities: status.capabilities, recent: diagnostics.slice(-8) }, null, 2)}
      </pre>
    </details>
  );
}
