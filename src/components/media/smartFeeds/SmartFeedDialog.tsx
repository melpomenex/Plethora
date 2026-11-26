import type React from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CloudArrowUp,
  DownloadSimple,
  Folder,
  ShieldCheck,
  Sparkle,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { Feed } from "../../../api/rss";
import type {
  CreateSmartFeedInput,
  SmartFeedCapabilities,
  SmartFeedClassificationMode,
  SmartFeedSourceScope,
  SmartFeedsExportPayload,
  SmartFeedStrictness,
  SmartFeedWithStats,
  UpdateSmartFeedInput,
} from "../../../api/rss-smart-feeds";
import { useI18n } from "../../../lib/i18n";
import { ensureCloudAiDisclosure } from "../../../lib/privacy/cloudAiDisclosure";
import { cn } from "../../../utils";
import { SmartFeedsDecisionModelControl } from "./SmartFeedsDecisionModelControl";

interface SmartFeedStarterExample {
  key: string;
  name: string;
  description: string;
  inclusion_criteria: string;
  exclusion_criteria: string;
}

const STARTER_EXAMPLES: SmartFeedStarterExample[] = [
  {
    key: "ai-news",
    name: "AI News",
    description:
      "Important developments in artificial intelligence, including new model releases, research breakthroughs, reasoning models, local inference, open-source AI, model architectures, and developer tooling.",
    inclusion_criteria: "Model launches, benchmarks, open weights, inference optimization",
    exclusion_criteria:
      "Generic AI productivity advice, promotional content without substantive technical information, superficial listicles, and unrelated technology news.",
  },
  {
    key: "iran-war",
    name: "Iran War",
    description:
      "Military developments involving Iran, regional security, diplomatic negotiations, conflict-related sanctions, international responses, humanitarian consequences, ceasefire discussions, and relevant geopolitical developments.",
    inclusion_criteria: "Ceasefire talks, regional security, diplomatic responses, sanctions",
    exclusion_criteria:
      "Unrelated Iranian tourism, cuisine, saffron recipes, entertainment, and everyday domestic news without a meaningful connection to the specified conflict.",
  },
  {
    key: "cs-research",
    name: "Computer Science Research",
    description:
      "New research in algorithms, systems, compilers, distributed computing, consensus protocols, programming languages, and theoretical computer science.",
    inclusion_criteria: "Systems papers, compiler optimization, distributed protocols, proofs",
    exclusion_criteria: "Consumer gadget reviews, corporate PR announcements, lifestyle tech.",
  },
  {
    key: "local-ai",
    name: "Local AI",
    description:
      "On-device inference, small language models, quantization, efficient architectures, Apple/Android NPU acceleration, and open-source inference engines.",
    inclusion_criteria: "4-bit quantization, GGUF, llama.cpp, LiteRT, edge inference",
    exclusion_criteria: "Enterprise SaaS pricing promotions, generic cloud marketing.",
  },
  {
    key: "cybersecurity",
    name: "Cybersecurity",
    description:
      "Important vulnerabilities, exploits, CVE advisories, cryptography, security research, and defensive engineering.",
    inclusion_criteria: "Zero-day advisories, protocol flaws, defensive patches, threat analysis",
    exclusion_criteria: "Stock ticker commentary, generic consumer antivirus ads.",
  },
];

export interface SmartFeedDialogProps {
  isOpen: boolean;
  editing?: SmartFeedWithStats | null;
  feeds: Feed[];
  sections: Array<{ id: string; name: string; feeds: Feed[]; isFolder: boolean; folderId?: string }>;
  capabilities: SmartFeedCapabilities | null;
  onClose: () => void;
  onSave: (
    payload: CreateSmartFeedInput | UpdateSmartFeedInput,
    editingId?: string,
  ) => Promise<void>;
  onExport?: () => Promise<SmartFeedsExportPayload>;
  onImport?: (payload: SmartFeedsExportPayload) => Promise<{ imported: number; skipped: number }>;
}

export function SmartFeedDialog({
  isOpen,
  editing,
  feeds,
  sections,
  capabilities,
  onClose,
  onSave,
  onExport,
  onImport,
}: SmartFeedDialogProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const descInputRef = useRef<HTMLTextAreaElement | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const titleId = useId();
  const nameId = useId();
  const nameErrId = useId();
  const descId = useId();
  const descHelpId = useId();
  const descErrId = useId();
  const exclId = useId();
  const inclId = useId();
  const freshnessId = useId();
  const consentErrId = useId();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [inclusionCriteria, setInclusionCriteria] = useState("");
  const [exclusionCriteria, setExclusionCriteria] = useState("");
  const [sourceScope, setSourceScope] = useState<SmartFeedSourceScope>("all");
  const [selectedFeedIds, setSelectedFeedIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [strictness, setStrictness] = useState<SmartFeedStrictness>("balanced");
  const [mode, setMode] = useState<SmartFeedClassificationMode>("fast_local");
  const [freshnessWindow, setFreshnessWindow] = useState<string>("");
  const [groupSimilarStories, setGroupSimilarStories] = useState(true);
  const [isEnabled, setIsEnabled] = useState(true);
  const [cloudConsentGranted, setCloudConsentGranted] = useState(false);

  const [touched, setTouched] = useState<{ name?: boolean; description?: boolean; consent?: boolean }>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [portabilityMessage, setPortabilityMessage] = useState<string | null>(null);

  // Sync form state whenever dialog opens or target changes.
  useEffect(() => {
    if (!isOpen) return;
    setTouched({});
    setSubmitted(false);
    setSubmitting(false);
    setSubmitError(null);
    setPortabilityMessage(null);
    if (editing) {
      setName(editing.name);
      setDescription(editing.description);
      setInclusionCriteria(editing.inclusion_criteria);
      setExclusionCriteria(editing.exclusion_criteria);
      setSourceScope(
        editing.source_scope === "external_discovery" ? "all" : editing.source_scope,
      );
      setSelectedFeedIds(new Set(editing.source_scope_config?.feed_ids ?? []));
      setSelectedFolderIds(new Set(editing.source_scope_config?.folder_ids ?? []));
      setStrictness(editing.curation_strictness);
      setMode(editing.classification_mode);
      setFreshnessWindow(
        editing.freshness_window_days != null ? String(editing.freshness_window_days) : "",
      );
      setGroupSimilarStories(editing.group_similar_stories);
      setIsEnabled(editing.is_enabled);
      setCloudConsentGranted(editing.cloud_consent_granted);
    } else {
      setName("");
      setDescription("");
      setInclusionCriteria("");
      setExclusionCriteria("");
      setSourceScope("all");
      setSelectedFeedIds(new Set());
      setSelectedFolderIds(new Set());
      setStrictness("balanced");
      setMode("fast_local");
      setFreshnessWindow("");
      setGroupSimilarStories(true);
      setIsEnabled(true);
      setCloudConsentGranted(false);
    }
  }, [isOpen, editing]);

  // Open/close native <dialog> via showModal() / close().
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen) {
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") {
          try {
            dialog.showModal();
          } catch {
            dialog.setAttribute("open", "");
          }
        } else {
          dialog.setAttribute("open", "");
        }
      }
    } else if (dialog.open) {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    }
  }, [isOpen]);

  // Native close listener + reset returnValue + light-dismiss fallback when closedby is unsupported.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = "";
      onClose();
    };
    dialog.addEventListener("close", handleClose);

    const supportsClosedBy =
      typeof HTMLDialogElement !== "undefined" && "closedBy" in HTMLDialogElement.prototype;
    if (supportsClosedBy) {
      return () => dialog.removeEventListener("close", handleClose);
    }

    let pressedOutside = false;
    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    const onPointerDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) {
        pressedOutside = false;
        if (typeof dialog.close === "function") dialog.close("dismiss");
        else onClose();
      }
      pressedOutside = false;
    };
    dialog.addEventListener("pointerdown", onPointerDown);
    dialog.addEventListener("pointerup", onPointerUp);

    return () => {
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("pointerdown", onPointerDown);
      dialog.removeEventListener("pointerup", onPointerUp);
    };
  }, [onClose]);

  const folderOptions = useMemo(
    () => sections.filter((s) => s.isFolder && s.folderId),
    [sections],
  );

  const needsCloudConsent = mode === "cloud" || mode === "hybrid";
  const nameInvalid = (touched.name || submitted) && name.trim().length === 0;
  const descInvalid =
    (touched.description || submitted) &&
    description.trim().length === 0 &&
    inclusionCriteria.trim().length === 0;
  const consentInvalid = (touched.consent || submitted) && needsCloudConsent && !cloudConsentGranted;

  const modeDisabledReason = (candidate: SmartFeedClassificationMode): string | null => {
    if (candidate === "fast_local") return null;
    if (!capabilities) return null;
    if (candidate === "intelligent_local" && !capabilities.intelligent_local_available) {
      return t("smartFeeds.modeUnavailableLocalLlm");
    }
    if ((candidate === "hybrid" || candidate === "cloud") && capabilities.strict_local_only) {
      return t("smartFeeds.modeBlockedStrictLocal");
    }
    if ((candidate === "hybrid" || candidate === "cloud") && !capabilities.cloud_llm_available) {
      return t("smartFeeds.modeUnavailableCloudLlm");
    }
    return null;
  };

  const applyStarterExample = (ex: SmartFeedStarterExample) => {
    setName(ex.name);
    setDescription(ex.description);
    setInclusionCriteria(ex.inclusion_criteria);
    setExclusionCriteria(ex.exclusion_criteria);
    setSubmitError(null);
  };

  const toggleFeedId = (id: string) => {
    setSelectedFeedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFolderId = (id: string) => {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setSubmitError(null);

    if (name.trim().length === 0) {
      nameInputRef.current?.focus();
      return;
    }
    if (description.trim().length === 0 && inclusionCriteria.trim().length === 0) {
      descInputRef.current?.focus();
      return;
    }
    if (needsCloudConsent && !cloudConsentGranted) {
      return;
    }

    if (needsCloudConsent) {
      const disclosed = await ensureCloudAiDisclosure({
        featureClass: "ai_actions",
        provider: capabilities?.cloud_llm_provider ?? "cloud",
        isLocal: false,
      });
      if (!disclosed) {
        setSubmitError(t("smartFeeds.cloudConsentDeclined"));
        return;
      }
    }

    const parsedFreshness =
      freshnessWindow.trim() === "" ? null : Math.max(1, Number.parseInt(freshnessWindow, 10) || 1);

    setSubmitting(true);
    try {
      await onSave(
        {
          name: name.trim(),
          description: description.trim(),
          inclusion_criteria: inclusionCriteria.trim(),
          exclusion_criteria: exclusionCriteria.trim(),
          source_scope: sourceScope,
          source_scope_config: {
            feed_ids: sourceScope === "selected_feeds" ? Array.from(selectedFeedIds) : [],
            folder_ids: sourceScope === "selected_folders" ? Array.from(selectedFolderIds) : [],
          },
          classification_mode: mode,
          curation_strictness: strictness,
          freshness_window_days: parsedFreshness,
          group_similar_stories: groupSimilarStories,
          is_enabled: isEnabled,
          cloud_consent_granted: needsCloudConsent ? cloudConsentGranted : false,
        },
        editing?.id,
      );
      if (dialogRef.current?.open && typeof dialogRef.current.close === "function") {
        dialogRef.current.close("saved");
      } else {
        onClose();
      }
    } catch (err) {
      setSubmitError((err as Error).message || t("smartFeeds.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportClick = async () => {
    if (!onExport) return;
    try {
      const payload = await onExport();
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `plethora-smart-feeds-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setPortabilityMessage(t("smartFeeds.exportedSuccess", { count: payload.smart_feeds.length }));
    } catch (err) {
      setPortabilityMessage((err as Error).message);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onImport) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as SmartFeedsExportPayload;
      const res = await onImport(parsed);
      setPortabilityMessage(
        t("smartFeeds.importedSuccess", { imported: res.imported, skipped: res.skipped }),
      );
    } catch (err) {
      setPortabilityMessage((err as Error).message);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: "any" } as Record<string, string>)}
      className="smart-feed-dialog m-auto w-[min(94vw,42rem)] max-h-[90vh] rounded-2xl border border-border bg-card text-card-foreground shadow-2xl p-0 overflow-hidden"
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col max-h-[90vh]">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
              <Sparkle className="w-4 h-4" weight="fill" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-foreground truncate">
                {editing ? t("smartFeeds.editTitle") : t("smartFeeds.createTitle")}
              </h2>
              <p className="text-xs text-muted-foreground truncate">
                {t("smartFeeds.dialogSubtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (dialogRef.current?.open && typeof dialogRef.current.close === "function") {
                dialogRef.current.close("cancel");
              } else {
                onClose();
              }
            }}
            className="p-2 min-w-[36px] min-h-[36px] text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            aria-label={t("common.close")}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {!editing && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground block">
                {t("smartFeeds.starterExamples")}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {STARTER_EXAMPLES.map((ex) => (
                  <button
                    key={ex.key}
                    type="button"
                    onClick={() => applyStarterExample(ex)}
                    className="px-2.5 py-1 text-xs rounded-full border border-border bg-background hover:bg-muted text-foreground transition-colors"
                  >
                    {ex.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Feed Name */}
          <div className="space-y-1.5">
            <label htmlFor={nameId} className="block text-xs font-semibold text-foreground">
              {t("smartFeeds.nameLabel")} <span aria-hidden="true" className="text-destructive">*</span>
            </label>
            <input
              ref={nameInputRef}
              id={nameId}
              name="name"
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched((p) => ({ ...p, name: true }))}
              aria-invalid={nameInvalid ? "true" : undefined}
              aria-describedby={nameInvalid ? nameErrId : undefined}
              placeholder={t("smartFeeds.namePlaceholder")}
              className="w-full min-h-[42px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            {nameInvalid && (
              <p id={nameErrId} className="text-xs text-destructive flex items-center gap-1" role="alert">
                <WarningCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                {t("smartFeeds.nameRequired")}
              </p>
            )}
          </div>

          {/* Topic Description */}
          <div className="space-y-1.5">
            <label htmlFor={descId} className="block text-xs font-semibold text-foreground">
              {t("smartFeeds.descriptionLabel")} <span aria-hidden="true" className="text-destructive">*</span>
            </label>
            <p id={descHelpId} className="text-xs text-muted-foreground">
              {t("smartFeeds.descriptionHelp")}
            </p>
            <textarea
              ref={descInputRef}
              id={descId}
              name="description"
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => setTouched((p) => ({ ...p, description: true }))}
              aria-invalid={descInvalid ? "true" : undefined}
              aria-describedby={descInvalid ? `${descHelpId} ${descErrId}` : descHelpId}
              placeholder={t("smartFeeds.descriptionPlaceholder")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground resize-y"
            />
            {descInvalid && (
              <p id={descErrId} className="text-xs text-destructive flex items-center gap-1" role="alert">
                <WarningCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                {t("smartFeeds.descriptionRequired")}
              </p>
            )}
          </div>

          {/* Exclusions */}
          <div className="space-y-1.5">
            <label htmlFor={exclId} className="block text-xs font-semibold text-foreground">
              {t("smartFeeds.exclusionsLabel")}
            </label>
            <textarea
              id={exclId}
              name="exclusion_criteria"
              rows={2}
              value={exclusionCriteria}
              onChange={(e) => setExclusionCriteria(e.target.value)}
              placeholder={t("smartFeeds.exclusionsPlaceholder")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground resize-y"
            />
          </div>

          {/* Sources */}
          <fieldset className="space-y-2 border border-border/70 rounded-xl p-3.5 bg-background/40">
            <legend className="px-1.5 text-xs font-semibold text-foreground">
              {t("smartFeeds.sourcesLabel")}
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(
                [
                  ["all", t("smartFeeds.scopeAll")],
                  ["selected_feeds", t("smartFeeds.scopeSelectedFeeds")],
                  ["selected_folders", t("smartFeeds.scopeSelectedFolders")],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={cn(
                    "flex items-center gap-2 p-2.5 rounded-lg border text-xs cursor-pointer transition-colors",
                    sourceScope === value
                      ? "border-primary bg-primary/10 text-foreground font-medium"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  <input
                    type="radio"
                    name="source_scope"
                    value={value}
                    checked={sourceScope === value}
                    onChange={() => setSourceScope(value)}
                    className="accent-primary"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            {sourceScope === "selected_feeds" && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-background p-2 space-y-1">
                {feeds.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-2">{t("smartFeeds.noFeedsAvailable")}</p>
                ) : (
                  feeds.map((f) => (
                    <label
                      key={f.id}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={selectedFeedIds.has(f.id)}
                        onChange={() => toggleFeedId(f.id)}
                        className="accent-primary"
                      />
                      <span className="truncate">{f.title}</span>
                    </label>
                  ))
                )}
              </div>
            )}

            {sourceScope === "selected_folders" && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-background p-2 space-y-1">
                {folderOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-2">{t("smartFeeds.noFoldersAvailable")}</p>
                ) : (
                  folderOptions.map((sec) => (
                    <label
                      key={sec.id}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={selectedFolderIds.has(sec.folderId!)}
                        onChange={() => toggleFolderId(sec.folderId!)}
                        className="accent-primary"
                      />
                      <Folder className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                      <span className="truncate">{sec.name}</span>
                    </label>
                  ))
                )}
              </div>
            )}
          </fieldset>

          {/* Curation Strictness */}
          <fieldset className="space-y-2 border border-border/70 rounded-xl p-3.5 bg-background/40">
            <legend className="px-1.5 text-xs font-semibold text-foreground">
              {t("smartFeeds.strictnessLabel")}
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(
                [
                  ["broad", t("smartFeeds.strictnessBroad"), t("smartFeeds.strictnessBroadDesc")],
                  ["balanced", t("smartFeeds.strictnessBalanced"), t("smartFeeds.strictnessBalancedDesc")],
                  ["strict", t("smartFeeds.strictnessStrict"), t("smartFeeds.strictnessStrictDesc")],
                ] as const
              ).map(([value, title, desc]) => (
                <label
                  key={value}
                  className={cn(
                    "flex flex-col gap-0.5 p-2.5 rounded-lg border cursor-pointer transition-colors",
                    strictness === value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <input
                      type="radio"
                      name="curation_strictness"
                      value={value}
                      checked={strictness === value}
                      onChange={() => setStrictness(value)}
                      className="accent-primary"
                    />
                    <span>{title}</span>
                  </div>
                  <span className="text-[11px] leading-snug text-muted-foreground pl-5">{desc}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Decision Processing Mode */}
          <fieldset className="space-y-2 border border-border/70 rounded-xl p-3.5 bg-background/40">
            <legend className="px-1.5 text-xs font-semibold text-foreground">
              {t("smartFeeds.processingModeLabel")}
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(
                [
                  ["fast_local", t("smartFeeds.modeFastLocal"), t("smartFeeds.modeFastLocalDesc")],
                  [
                    "intelligent_local",
                    t("smartFeeds.modeIntelligentLocal"),
                    t("smartFeeds.modeIntelligentLocalDesc"),
                  ],
                  ["hybrid", t("smartFeeds.modeHybrid"), t("smartFeeds.modeHybridDesc")],
                  ["cloud", t("smartFeeds.modeCloud"), t("smartFeeds.modeCloudDesc")],
                ] as const
              ).map(([value, title, desc]) => {
                const blockedReason = modeDisabledReason(value);
                const disabled = Boolean(blockedReason);
                return (
                  <label
                    key={value}
                    className={cn(
                      "flex flex-col gap-0.5 p-2.5 rounded-lg border transition-colors",
                      disabled ? "opacity-55 cursor-not-allowed bg-muted/30" : "cursor-pointer",
                      mode === value && !disabled
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background",
                    )}
                  >
                    <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                      <input
                        type="radio"
                        name="classification_mode"
                        value={value}
                        disabled={disabled}
                        checked={mode === value}
                        onChange={() => setMode(value)}
                        className="accent-primary"
                      />
                      <span>{title}</span>
                      {value === "intelligent_local" &&
                        !disabled &&
                        capabilities?.local_llm_model && (
                          <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                            {capabilities.local_llm_model}
                          </span>
                        )}
                    </div>
                    <span className="text-[11px] leading-snug text-muted-foreground pl-5">
                      {blockedReason ?? desc}
                    </span>
                  </label>
                );
              })}
            </div>

            {capabilities && !capabilities.semantic_embeddings_available && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5 pt-1">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                {t("smartFeeds.lexicalFallbackNotice")}
              </p>
            )}

            <SmartFeedsDecisionModelControl variant="inline" />

            {needsCloudConsent && (
              <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                <div className="flex items-start gap-2 text-xs text-foreground">
                  <CloudArrowUp className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="leading-relaxed">{t("smartFeeds.cloudPrivacyNotice")}</p>
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cloudConsentGranted}
                    onChange={(e) => {
                      setCloudConsentGranted(e.target.checked);
                      setTouched((p) => ({ ...p, consent: true }));
                    }}
                    aria-invalid={consentInvalid ? "true" : undefined}
                    aria-describedby={consentInvalid ? consentErrId : undefined}
                    className="accent-primary"
                  />
                  <span>{t("smartFeeds.cloudConsentCheckbox")}</span>
                </label>
                {consentInvalid && (
                  <p id={consentErrId} className="text-xs text-destructive" role="alert">
                    {t("smartFeeds.cloudConsentRequired")}
                  </p>
                )}
              </div>
            )}
          </fieldset>

          {/* Advanced */}
          <details className="rounded-xl border border-border/70 bg-background/40 px-3.5 py-2.5">
            <summary className="cursor-pointer text-xs font-semibold text-foreground select-none">
              {t("smartFeeds.advancedSection")}
            </summary>
            <div className="mt-3 space-y-3">
              <div className="space-y-1">
                <label htmlFor={inclId} className="block text-xs font-medium text-muted-foreground">
                  {t("smartFeeds.inclusionCriteriaLabel")}
                </label>
                <input
                  id={inclId}
                  type="text"
                  value={inclusionCriteria}
                  onChange={(e) => setInclusionCriteria(e.target.value)}
                  placeholder={t("smartFeeds.inclusionCriteriaPlaceholder")}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <div className="space-y-1">
                  <label
                    htmlFor={freshnessId}
                    className="block text-xs font-medium text-muted-foreground"
                  >
                    {t("smartFeeds.freshnessWindowLabel")}
                  </label>
                  <select
                    id={freshnessId}
                    value={freshnessWindow}
                    onChange={(e) => setFreshnessWindow(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
                  >
                    <option value="">{t("smartFeeds.freshnessAllTime")}</option>
                    <option value="7">{t("smartFeeds.freshnessDays", { days: 7 })}</option>
                    <option value="30">{t("smartFeeds.freshnessDays", { days: 30 })}</option>
                    <option value="90">{t("smartFeeds.freshnessDays", { days: 90 })}</option>
                  </select>
                </div>

                <div className="space-y-2 pb-1">
                  <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={groupSimilarStories}
                      onChange={(e) => setGroupSimilarStories(e.target.checked)}
                      className="accent-primary"
                    />
                    <span>{t("smartFeeds.groupSimilarStories")}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={(e) => setIsEnabled(e.target.checked)}
                      className="accent-primary"
                    />
                    <span>{t("smartFeeds.enabledAutoUpdate")}</span>
                  </label>
                </div>
              </div>

              {(onExport || onImport) && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50">
                  {onExport && (
                    <button
                      type="button"
                      onClick={handleExportClick}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border bg-background hover:bg-muted text-foreground"
                    >
                      <DownloadSimple className="w-3.5 h-3.5" aria-hidden="true" />
                      {t("smartFeeds.exportJson")}
                    </button>
                  )}
                  {onImport && (
                    <>
                      <input
                        ref={importFileRef}
                        type="file"
                        accept="application/json,.json"
                        className="sr-only"
                        onChange={handleImportFile}
                      />
                      <button
                        type="button"
                        onClick={() => importFileRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border bg-background hover:bg-muted text-foreground"
                      >
                        <UploadSimple className="w-3.5 h-3.5" aria-hidden="true" />
                        {t("smartFeeds.importJson")}
                      </button>
                    </>
                  )}
                  {portabilityMessage && (
                    <span className="text-[11px] text-muted-foreground">{portabilityMessage}</span>
                  )}
                </div>
              )}
            </div>
          </details>

          {submitError && (
            <p className="text-xs text-destructive flex items-center gap-1.5" role="alert">
              <WarningCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              {submitError}
            </p>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border bg-muted/40">
          <button
            type="button"
            onClick={() => {
              if (dialogRef.current?.open && typeof dialogRef.current.close === "function") {
                dialogRef.current.close("cancel");
              } else {
                onClose();
              }
            }}
            className="px-3.5 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {submitting
              ? t("smartFeeds.saving")
              : editing
                ? t("common.save")
                : t("smartFeeds.createButton")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
