import { useEffect, useMemo, useState } from "react";
import { listLanguageLexicalEntries } from "../../api/languageLexicon";
import { useLanguageLearningHost } from "../../contexts/LanguageLearningHostContext";
import { hasCloudProvider, isAnyAiAvailable } from "../../lib/ai/provider";
import { useI18n } from "../../lib/i18n";
import { LANGUAGE_HOST_ACTION_EVENT, type LanguageHostActionDetail } from "../../lib/languageHost";
import { normalizeForLookup } from "../../lib/languageProcessing/unicode";
import { applyReadingAssistSpans, clearReadingAssistSpans, readingAssistStyleText } from "../../lib/languageReadingAssist/domDecoration";
import { createProductionReadingAssistRegistry } from "../../lib/languageReadingAssist/productionRegistry";
import type { ReadingAssistRegistry } from "../../lib/languageReadingAssist/registry";
import type { ReadingAssistKind, ReadingAssistResult } from "../../lib/languageReadingAssist/types";

interface AssistKindOption {
  kind: ReadingAssistKind;
  labelKey: string;
  fallbackLabel: string;
}

const ASSIST_KIND_OPTIONS: readonly AssistKindOption[] = [
  { kind: "ruby", labelKey: "language.readingAssist.kind.ruby", fallbackLabel: "Ruby / Furigana" },
  { kind: "transliteration", labelKey: "language.readingAssist.kind.transliteration", fallbackLabel: "Transliteration / Pinyin" },
  { kind: "segmentation", labelKey: "language.readingAssist.kind.segmentation", fallbackLabel: "Word Segmentation" },
  { kind: "bidi", labelKey: "language.readingAssist.kind.bidi", fallbackLabel: "Bidi / RTL" },
  { kind: "gloss", labelKey: "language.readingAssist.kind.gloss", fallbackLabel: "AI Gloss" },
];

type FamiliarityFilter = "all" | "hide-known";

function preferredKindsForLanguage(languageTag: string, aiAvailable: boolean): readonly ReadingAssistKind[] {
  const base = languageTag.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  if (base === "ja") {
    return aiAvailable
      ? ["ruby", "segmentation", "gloss", "transliteration", "bidi"]
      : ["ruby", "segmentation", "transliteration", "bidi", "gloss"];
  }
  if (base === "zh" || base === "ko") {
    return aiAvailable
      ? ["transliteration", "segmentation", "gloss", "ruby", "bidi"]
      : ["transliteration", "segmentation", "ruby", "bidi", "gloss"];
  }
  if (base === "ar" || base === "he" || base === "fa" || base === "ur") {
    return aiAvailable
      ? ["bidi", "gloss", "segmentation", "transliteration", "ruby"]
      : ["bidi", "segmentation", "transliteration", "ruby", "gloss"];
  }
  return ["gloss", "transliteration", "ruby", "segmentation", "bidi"];
}

export function selectDefaultReadingAssistKind(
  languageTag: string,
  registry: ReadingAssistRegistry,
  aiAvailable: boolean,
): ReadingAssistKind {
  const order = preferredKindsForLanguage(languageTag, aiAvailable);
  for (const kind of order) {
    if (kind === "gloss" && !aiAvailable) {
      // Still allow gloss as fallback if no local kind matches, handled after the loop.
      continue;
    }
    if (registry.supports(kind, languageTag)) {
      return kind;
    }
  }
  return order.find((kind) => registry.supports(kind, languageTag)) ?? "gloss";
}

function collectReadingAssistRoots(): ParentNode[] {
  const roots = new Set<ParentNode>();
  document.querySelectorAll("[data-language-content-root]").forEach((node) => roots.add(node));
  document.querySelectorAll("[data-transcript-scroll]").forEach((node) => roots.add(node));
  document.querySelectorAll("[data-x-thread-viewer]").forEach((node) => roots.add(node));
  document.querySelectorAll("iframe").forEach((iframe) => {
    try {
      const doc = (iframe as HTMLIFrameElement).contentDocument;
      if (doc?.body) roots.add(doc.body);
    } catch {
      // Cross-origin frames cannot be decorated.
    }
  });
  return Array.from(roots);
}

/** Source-preserving reading-assist surface with truthful unsupported states. */
export function LanguageReadingAssistOverlay() {
  const { snapshot, readingAssistRegistry } = useLanguageLearningHost();
  const { t } = useI18n();
  const fallbackRegistry = useMemo(() => createProductionReadingAssistRegistry(), []);
  const registry = readingAssistRegistry ?? fallbackRegistry;

  const [request, setRequest] = useState<LanguageHostActionDetail | null>(null);
  const [aiAvailable, setAiAvailable] = useState<boolean>(() => hasCloudProvider());
  const [selectedKind, setSelectedKind] = useState<ReadingAssistKind>("gloss");
  const [familiarityFilter, setFamiliarityFilter] = useState<FamiliarityFilter>("all");
  const [knownForms, setKnownForms] = useState<ReadonlySet<string>>(() => new Set());
  const [status, setStatus] = useState<"pending" | "ready" | "unsupported" | "failed">("pending");
  const [assistResult, setAssistResult] = useState<ReadingAssistResult | null>(null);

  const targetLanguage = snapshot.profile?.targetLanguage ?? request?.languageTag ?? "";
  const passage = useMemo(
    () => request?.selectedText?.trim() || request?.source.text?.trim() || "",
    [request],
  );

  useEffect(() => {
    let active = true;
    void isAnyAiAvailable("prompt")
      .then((available) => {
        if (active) setAiAvailable(available);
      })
      .catch(() => {
        if (active) setAiAvailable(hasCloudProvider());
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<LanguageHostActionDetail>).detail;
      if (detail?.hostId === snapshot.hostId && detail.action === "reading-assist") {
        const lang = snapshot.profile?.targetLanguage ?? detail.languageTag ?? "";
        setSelectedKind(selectDefaultReadingAssistKind(lang, registry, aiAvailable));
        setRequest(detail);
      }
    };
    window.addEventListener(LANGUAGE_HOST_ACTION_EVENT, onAction);
    return () => window.removeEventListener(LANGUAGE_HOST_ACTION_EVENT, onAction);
  }, [aiAvailable, registry, snapshot.hostId, snapshot.profile?.targetLanguage]);

  useEffect(() => {
    let disposed = false;
    const profileId = snapshot.profile?.id;
    const lang = snapshot.profile?.targetLanguage;
    if (!request || snapshot.status !== "ready" || !profileId || !lang) {
      setKnownForms(new Set());
      return () => {
        disposed = true;
      };
    }

    void listLanguageLexicalEntries(profileId, { languageTag: lang, offset: 0, limit: 500 })
      .then((page) => {
        if (disposed) return;
        const next = new Set<string>();
        for (const entry of page.items) {
          if (entry.knowledgeState !== "known") continue;
          if (entry.normalizedForm) next.add(normalizeForLookup(entry.normalizedForm, lang));
          if (entry.canonicalForm) next.add(normalizeForLookup(entry.canonicalForm, lang));
          if (entry.lemma) next.add(normalizeForLookup(entry.lemma, lang));
        }
        setKnownForms(next);
      })
      .catch(() => {
        if (!disposed) setKnownForms(new Set());
      });

    return () => {
      disposed = true;
    };
  }, [request, snapshot.profile?.id, snapshot.profile?.targetLanguage, snapshot.status]);

  useEffect(() => {
    let disposed = false;
    if (!request || snapshot.status !== "ready" || !snapshot.profile) {
      return () => {
        disposed = true;
      };
    }
    const controller = new AbortController();
    setStatus("pending");
    setAssistResult(null);

    void registry
      .run(
        {
          sourceId: request.source.contentId,
          contentFingerprint: request.source.contentFingerprint ?? request.source.source.contentFingerprint ?? "-",
          text: passage,
          languageTag: snapshot.profile.targetLanguage,
          profileId: snapshot.profile.id,
          kind: selectedKind,
        },
        controller.signal,
      )
      .then((result) => {
        if (disposed) return;
        setStatus(result.status === "ready" ? "ready" : result.status === "unsupported" ? "unsupported" : "failed");
        setAssistResult(result.status === "ready" ? result : null);
      })
      .catch(() => {
        if (!disposed) {
          setStatus("failed");
          setAssistResult(null);
        }
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [passage, registry, request, selectedKind, snapshot.profile, snapshot.status]);

  const visibleSpans = useMemo(() => {
    if (!assistResult?.spans.length) return [];
    if (familiarityFilter !== "hide-known" || knownForms.size === 0) {
      return assistResult.spans;
    }
    return assistResult.spans.filter(
      (span) => !knownForms.has(normalizeForLookup(span.sourceText, targetLanguage)),
    );
  }, [assistResult, familiarityFilter, knownForms, targetLanguage]);

  useEffect(() => {
    const roots = collectReadingAssistRoots();
    if (status !== "ready" || !visibleSpans.length || !passage) {
      for (const root of roots) clearReadingAssistSpans(root);
      return;
    }
    for (const root of roots) {
      applyReadingAssistSpans(root, passage, visibleSpans, {
        kind: assistResult?.kind ?? selectedKind,
        direction: assistResult?.direction,
      });
    }
    return () => {
      for (const root of roots) clearReadingAssistSpans(root);
    };
  }, [assistResult?.direction, assistResult?.kind, passage, selectedKind, status, visibleSpans]);

  const close = () => {
    for (const root of collectReadingAssistRoots()) clearReadingAssistSpans(root);
    setAssistResult(null);
    setStatus("pending");
    setRequest(null);
  };

  if (!request || snapshot.status !== "ready") return null;

  const activeOption = ASSIST_KIND_OPTIONS.find((option) => option.kind === selectedKind) ?? ASSIST_KIND_OPTIONS[0];
  const activeKindLabel = t(activeOption.labelKey, activeOption.fallbackLabel);
  const titleText = t("language.readingAssist.title", "Reading assist");

  const statusText =
    status === "pending"
      ? t("language.readingAssist.checking", "Checking available source-preserving assistance…")
      : status === "ready"
        ? visibleSpans.length > 0
          ? selectedKind === "segmentation"
            ? t("language.readingAssist.segmentedCount", "Marked {count} word boundaries without modifying source text.", {
                count: visibleSpans.length,
              })
            : t("language.readingAssist.appliedCount", "Applied {count} {mode} annotations in the document.", {
                count: visibleSpans.length,
                mode: activeKindLabel,
              })
          : assistResult?.spans.length && familiarityFilter === "hide-known"
            ? t("language.readingAssist.allKnown", "All annotated words are marked known; source text remains unchanged.")
            : t("language.readingAssist.readyUnchanged", "Assistance ready; source text remains unchanged.")
        : !snapshot.capabilities.readingAssist.available && snapshot.capabilities.readingAssist.detail
          ? snapshot.capabilities.readingAssist.detail
          : t(
              "language.readingAssist.unsupported",
              "No compatible reading-assist provider is configured for this mode and language.",
            );

  return (
    <>
      <style data-language-reading-assist-style>{readingAssistStyleText()}</style>
      <div
        className="fixed inset-x-4 bottom-20 z-[75] mx-auto max-w-lg rounded-xl border border-border bg-card p-3 text-sm shadow-xl"
        role="region"
        aria-label={titleText}
        data-language-reading-assist="true"
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{titleText}</p>

            <div
              className="mt-2 flex flex-wrap gap-1"
              role="group"
              aria-label={t("language.readingAssist.modeGroupLabel", "Reading assist mode")}
            >
              {ASSIST_KIND_OPTIONS.map((option) => {
                const label = t(option.labelKey, option.fallbackLabel);
                const active = selectedKind === option.kind;
                return (
                  <button
                    key={option.kind}
                    type="button"
                    aria-pressed={active}
                    className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                      active
                        ? "border-primary bg-primary/10 font-medium text-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    onClick={() => setSelectedKind(option.kind)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div
              className="mt-2 flex items-center gap-1.5"
              role="group"
              aria-label={t("language.readingAssist.filterGroupLabel", "Word familiarity filter")}
            >
              <button
                type="button"
                aria-pressed={familiarityFilter === "all"}
                className={`rounded border px-2 py-0.5 text-xs ${
                  familiarityFilter === "all"
                    ? "border-primary bg-primary/10 font-medium text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
                onClick={() => setFamiliarityFilter("all")}
              >
                {t("language.readingAssist.filter.all", "All words")}
              </button>
              <button
                type="button"
                aria-pressed={familiarityFilter === "hide-known"}
                className={`rounded border px-2 py-0.5 text-xs ${
                  familiarityFilter === "hide-known"
                    ? "border-primary bg-primary/10 font-medium text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
                onClick={() => setFamiliarityFilter("hide-known")}
              >
                {t("language.readingAssist.filter.hideKnown", "Hide known words")}
              </button>
            </div>

            <p className="mt-2 text-xs text-muted-foreground" role="status" aria-live="polite">
              {statusText}
            </p>

            {status === "ready" && visibleSpans.length > 0 ? (
              <ul
                className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs"
                dir={assistResult?.direction === "rtl" ? "rtl" : undefined}
              >
                {visibleSpans.map((span) => (
                  <li key={span.id}>
                    <span className="font-medium">{span.sourceText}</span>
                    {span.annotation || span.renderedText ? (
                      <span className="text-muted-foreground"> — {span.annotation ?? span.renderedText}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <button
            type="button"
            className="shrink-0 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
            aria-label={t("language.readingAssist.closeLabel", "Close reading assist")}
            onClick={close}
          >
            {t("common.close", "Close")}
          </button>
        </div>
      </div>
    </>
  );
}
