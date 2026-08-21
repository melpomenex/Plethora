/**
 * Local-Only Shield toggle (Change C task 1.4).
 *
 * Surfaces the existing `isLocalOnly` document flag as a functional user
 * control. When enabled, `isCloudEligible(document)` returns false and every
 * cloud pathway (sync, AI/RAG, OCR, TTS, transcription) diverts to on-device
 * processing for that document (see docs/PRIVACY_ARCHITECTURE.md §3).
 *
 * Placement: item-details popover, document targets only.
 */

import { useState } from "react";
import { Shield } from "@phosphor-icons/react";
import { updateDocument } from "../../api/documents";
import { useToast } from "../common/Toast";
import type { Document } from "../../types/document";

interface LocalOnlyShieldToggleProps {
  documentId: string;
  /** The raw document, used to read the current flag and persist safely. */
  baseDocument?: Document | null;
  onChanged?: (isLocalOnly: boolean) => void;
}

export function LocalOnlyShieldToggle({
  documentId,
  baseDocument,
  onChanged,
}: LocalOnlyShieldToggleProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const checked = baseDocument?.isLocalOnly === true || baseDocument?.metadata?.isLocalOnly === true;

  const handleToggle = async () => {
    if (!baseDocument || busy) return;
    const next = !checked;
    setBusy(true);
    try {
      await updateDocument(documentId, { ...baseDocument, isLocalOnly: next });
      onChanged?.(next);
      toast.success(
        next
          ? "Local-Only Shield enabled — this document will never leave your device"
          : "Local-Only Shield disabled — cloud features may process this document"
      );
    } catch (err) {
      console.error("Failed to update Local-Only shield", err);
      toast.error(
        "Failed to update the Local-Only Shield",
        err instanceof Error ? err.message : "Please try again"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="flex items-start gap-2 cursor-pointer select-none" data-testid="local-only-shield-toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={busy || !baseDocument}
        onChange={handleToggle}
        className="mt-0.5 accent-emerald-600"
      />
      <span className="inline-flex items-center gap-1 text-xs text-foreground">
        <Shield className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
        Local-Only Shield
      </span>
      <span className="text-xs text-muted-foreground">
        {checked ? "Never leaves this device" : "May use cloud features"}
      </span>
    </label>
  );
}
