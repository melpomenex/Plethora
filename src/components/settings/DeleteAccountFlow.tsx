/**
 * Multi-step account deletion flow (Change F §1.1).
 *
 * Replaces the old single `modal.confirm` deletion path. Steps:
 *   1. Scope — plain-language description of exactly what is deleted (cloud
 *      account + cloud data) and what is NOT deleted (local library, Apple
 *      subscription billing), with an export-before-delete offer wired to
 *      `GET /v1/auth/export`.
 *   2. Confirm — explicit typed confirmation ("DELETE").
 *   3. Outcome — success (signed out, accurate confirmation) or failure
 *      (explicit error + retry, user REMAINS signed in).
 *
 * Failure never signs the user out and never masquerades as success.
 */

import { useState } from 'react';
import { useAccountStore } from '../../stores/accountStore';
import { useSyncStore } from '../../stores/syncStore';
import { PLETHORA_API_URL } from '../../config/product';

const CONFIRM_PHRASE = 'DELETE';

type Step =
  | { kind: 'scope' }
  | { kind: 'confirm' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

interface DeleteAccountFlowProps {
  open: boolean;
  onClose: () => void;
}

async function downloadCloudExport(token: string | undefined): Promise<void> {
  const res = await fetch(`${PLETHORA_API_URL}/v1/auth/export`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error('Export request failed');
  }
  const data = await res.json();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `plethora-cloud-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function DeleteAccountFlow({ open, onClose }: DeleteAccountFlowProps) {
  const [step, setStep] = useState<Step>({ kind: 'scope' });
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  if (!open) return null;

  const handleExport = async () => {
    setIsExporting(true);
    setExportNote(null);
    try {
      await downloadCloudExport(useAccountStore.getState().tokens?.accessToken);
      setExportNote('Export downloaded. Store it somewhere safe before deleting your account.');
    } catch {
      setExportNote('Export failed — check your connection. You can retry or continue without exporting.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const token = useAccountStore.getState().tokens?.accessToken;
      const res = await fetch(`${PLETHORA_API_URL}/v1/auth/account`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const message =
          errData?.error?.message ||
          'Account deletion failed on the server. Your account and data remain intact — you are still signed in.';
        setStep({ kind: 'error', message });
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (data?.success !== true) {
        setStep({
          kind: 'error',
          message:
            'The server did not confirm deletion. Your account and data remain intact — you are still signed in.',
        });
        return;
      }

      // Confirmed deletion: clear the local session and disable cloud sync
      // cleanly. The app continues in local-only mode (local library is kept).
      await useAccountStore.getState().signOut();
      useSyncStore.setState({
        isSyncing: false,
        lastSyncedAt: null,
        pendingOutboxCount: 0,
      });
      setStep({ kind: 'success' });
    } catch (err) {
      // Network failure / unexpected error: remain signed in, offer retry.
      const detail = err instanceof Error ? err.message : String(err);
      setStep({
        kind: 'error',
        message: `Account deletion could not be completed (${detail}). Your account and data remain intact — you are still signed in.`,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const reset = () => {
    setStep({ kind: 'scope' });
    setConfirmText('');
    setExportNote(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Delete account"
      data-testid="delete-account-flow"
    >
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
        {step.kind === 'scope' && (
          <>
            <h2 className="text-lg font-semibold text-destructive">Delete your Plethora account?</h2>

            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">This permanently deletes, for every device:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Your Plethora account and sign-in sessions</li>
                <li>Cloud-synced data, sync history, and device registrations</li>
                <li>API tokens, webhooks, and cloud usage records</li>
              </ul>

              <p className="font-medium text-foreground pt-2">This does NOT delete:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Your local library — documents, notes, and flashcards on this device stay</li>
                <li>
                  Your Apple subscription — if you subscribed via Apple, billing continues until you
                  cancel it separately in Apple Settings → Subscriptions
                </li>
              </ul>
            </div>

            <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
              <p className="text-sm text-muted-foreground">
                Want a copy of your cloud data first? Download a JSON archive of your account,
                devices, and metadata.
              </p>
              <button
                onClick={handleExport}
                disabled={isExporting}
                className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {isExporting ? 'Exporting…' : 'Export my cloud data first'}
              </button>
              {exportNote && <p className="text-xs text-muted-foreground">{exportNote}</p>}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  reset();
                  onClose();
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => setStep({ kind: 'confirm' })}
                className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 text-sm font-medium transition-colors"
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step.kind === 'confirm' && (
          <>
            <h2 className="text-lg font-semibold text-destructive">Confirm account deletion</h2>
            <p className="text-sm text-muted-foreground">
              This cannot be undone. Type <span className="font-mono font-semibold text-foreground">DELETE</span>{' '}
              to permanently delete your Plethora account and all cloud data. Your local library
              stays on this device; an Apple subscription is not cancelled.
            </p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type DELETE"
              aria-label="Type DELETE to confirm"
              className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-destructive"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setStep({ kind: 'scope' })}
                disabled={isDeleting}
                className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting || confirmText.trim() !== CONFIRM_PHRASE}
                className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 text-sm font-medium transition-colors"
              >
                {isDeleting ? 'Deleting…' : 'Delete my account permanently'}
              </button>
            </div>
          </>
        )}

        {step.kind === 'success' && (
          <>
            <h2 className="text-lg font-semibold">Account deleted</h2>
            <p className="text-sm text-muted-foreground">
              Your Plethora account and all cloud data have been permanently deleted. You have been
              signed out and cloud sync is disabled; this device now works in local-only mode with
              your local library intact.
            </p>
            <p className="text-sm text-muted-foreground">
              If you had an Apple subscription, note that it was <strong>not</strong> cancelled — it
              continues to bill until you cancel it in Apple Settings → Subscriptions.
            </p>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => {
                  reset();
                  onClose();
                }}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium transition-colors"
              >
                Done
              </button>
            </div>
          </>
        )}

        {step.kind === 'error' && (
          <>
            <h2 className="text-lg font-semibold text-destructive">Deletion failed</h2>
            <div
              className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm"
              role="alert"
            >
              {step.message}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  reset();
                  onClose();
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-muted transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => setStep({ kind: 'confirm' })}
                className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 text-sm font-medium transition-colors"
              >
                Retry deletion
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
