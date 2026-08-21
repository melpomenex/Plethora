import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise, Check, Clock, X } from "@phosphor-icons/react";
import { EmptyState } from "../components/common/EmptyState";
import { ItemTagEditor } from "../components/common/ItemTagEditor";
import { ActionButton } from "../components/common/UI";
import {
  listBrowserOrganizationTargets,
  updateBrowserOrganizationReview,
} from "../lib/smartTagging/browserOrganizationAdapter";
import { isNeedsReview, type BrowserOrganizationTarget } from "../lib/smartTagging/browserImportOrganization";
import { useSmartTaggingQueueStore } from "../stores/smartTaggingQueueStore";
import type { ItemTagTarget } from "../lib/tagEditing/types";

function itemTagTarget(target: BrowserOrganizationTarget): ItemTagTarget {
  return {
    type: target.targetType,
    id: target.targetId,
    tags: target.tags,
    smartTagDetails: target.organization?.details,
  };
}

function targetLabel(target: BrowserOrganizationTarget): string {
  switch (target.itemType) {
    case "page": return "Browser page";
    case "extract": return "Browser extract";
    case "image-occlusion": return "Image occlusion card";
    case "cloze": return "Cloze card";
    default: return "Q&A card";
  }
}

export function ImportNeedsReviewPage() {
  const [targets, setTargets] = useState<BrowserOrganizationTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await listBrowserOrganizationTargets();
      setTargets(all.filter((target) => isNeedsReview(target.organization)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load browser imports.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = async (target: BrowserOrganizationTarget, action: "confirm" | "dismiss" | "retry") => {
    setBusyId(target.targetId);
    try {
      await updateBrowserOrganizationReview(target, action);
      if (action === "retry") useSmartTaggingQueueStore.getState().enqueueTarget({
        ...target,
        organization: target.organization
          ? { ...target.organization, status: "queued" }
          : { schemaVersion: 1, status: "queued", confidenceBand: "none", fingerprint: "" },
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this import.");
    } finally {
      setBusyId(null);
    }
  };

  const actBulk = async (action: "confirm" | "dismiss") => {
    setBusyId("__bulk__");
    setError(null);
    try {
      const results = await Promise.allSettled(
        targets.map((target) => updateBrowserOrganizationReview(target, action)),
      );
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length > 0) {
        setError(`${failures.length} of ${targets.length} review updates failed; successful updates were kept.`);
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading browser imports…</div>;
  }

  if (error) {
    return <div className="p-8 text-sm text-destructive" role="alert">{error}</div>;
  }

  return (
    <main className="h-full overflow-y-auto p-4 md:p-8" aria-labelledby="import-review-title">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Browser imports</p>
            <h1 id="import-review-title" className="mt-1 text-2xl font-semibold text-foreground">Needs Review</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Confirm uncertain organization, adjust tags, or retry with the captured source context.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {targets.length > 1 && (
              <>
                <ActionButton variant="tertiary" size="compact" disabled={busyId !== null} onClick={() => void actBulk("dismiss")}>
                  Dismiss all
                </ActionButton>
                <ActionButton variant="primary" size="compact" disabled={busyId !== null} onClick={() => void actBulk("confirm")}>
                  Mark all correct
                </ActionButton>
              </>
            )}
            <ActionButton variant="tertiary" size="compact" disabled={busyId !== null} onClick={() => void load()}>
              <ArrowClockwise className="h-4 w-4" /> Refresh
            </ActionButton>
          </div>
        </header>

        {targets.length === 0 ? (
          <EmptyState
            icon={<Check className="h-10 w-10 text-emerald-500" />}
            title="Everything is organized"
            description="New browser imports with uncertain tags will appear here."
          />
        ) : (
          <div className="space-y-4">
            {targets.map((target) => {
              const organization = target.organization;
              const busy = busyId === target.targetId || busyId === "__bulk__";
              return (
                <article key={`${target.targetType}:${target.targetId}`} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{targetLabel(target)}</p>
                      <h2 className="mt-1 truncate text-base font-semibold text-foreground">{target.title || "Untitled import"}</h2>
                      {target.captureContext?.domain && <p className="mt-1 text-xs text-muted-foreground">{target.captureContext.domain}</p>}
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300">
                      <Clock className="h-3.5 w-3.5" /> {organization?.reviewReason || "Review"}
                    </span>
                  </div>

                  <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{target.content}</p>

                  <div className="mt-4 border-t border-border pt-3">
                    <ItemTagEditor
                      target={itemTagTarget(target)}
                      onTagsPersisted={(tags) => setTargets((current) => current.map((item) => item.targetId === target.targetId ? { ...item, tags } : item))}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <ActionButton variant="tertiary" size="compact" disabled={busy} onClick={() => void act(target, "dismiss")}>
                      <X className="h-4 w-4" /> Dismiss
                    </ActionButton>
                    <ActionButton variant="tertiary" size="compact" disabled={busy} onClick={() => void act(target, "retry")}>
                      <ArrowClockwise className="h-4 w-4" /> Retry
                    </ActionButton>
                    <ActionButton variant="primary" size="compact" disabled={busy} onClick={() => void act(target, "confirm")}>
                      <Check className="h-4 w-4" /> Mark correct
                    </ActionButton>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

export const ImportNeedsReviewTab = ImportNeedsReviewPage;
