import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "../md3/Dialog";
import { Button } from "../md3/Button";
import { useI18n } from "../../lib/i18n";
import { createTranslationService, type TranslationResult } from "../../lib/languageTranslation";
import { useOptionalLanguageLearningHost } from "../../contexts/LanguageLearningHostContext";
import { useLanguageProfileStore } from "../../stores/languageProfileStore";
import type { PaletteSelection } from "../../commandPalette/selectionTranslation";

export function SelectionTranslationDialog({ selection, onClose }: {
  selection: PaletteSelection;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const host = useOptionalLanguageLearningHost();
  const activeProfile = useLanguageProfileStore((state) => state.activeProfile);
  const profile = host?.snapshot.profile ?? activeProfile;
  const [sourceLanguage, setSourceLanguage] = useState(profile?.targetLanguage ?? "en");
  const [targetLanguage, setTargetLanguage] = useState(profile?.baseLanguage ?? "");
  const [allowCloud, setAllowCloud] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const service = useMemo(() => createTranslationService(), []);
  const translate = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const translated = await service.translate({
        text: selection.text,
        sourceLanguage: sourceLanguage.trim(),
        targetLanguage: targetLanguage.trim(),
        profileId: profile?.id ?? "selection-translation",
        sourceAnchor: selection.sourceAnchor ?? { sourceType: "text", documentId: selection.documentId, sourceId: selection.documentId },
        providerPolicy: { offline: !navigator.onLine, privacy: allowCloud ? "allow-cloud" : "local-only" },
      }, { signal: controller.signal });
      if (!controller.signal.aborted) setResult(translated);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  };
  useEffect(() => {
    if (profile) void translate();
    return () => controllerRef.current?.abort();
    // One invocation per captured passage. Form edits are explicitly submitted.
  }, [selection]);

  return (
    <Dialog open onClose={onClose} title={t("commandPalette.translateSelection")} closeLabel={t("common.close")}
      footer={<Button onClick={() => void translate()} disabled={pending || !targetLanguage.trim() || !sourceLanguage.trim()}>
        {pending ? t("selectionTranslation.loading") : error ? t("common.retry") : t("commandPalette.translateSelection")}
      </Button>}>
      <div className="space-y-4">
        <p className="whitespace-pre-wrap break-words text-sm text-on-surface-variant" dir="auto">{selection.text}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">{t("selectionTranslation.sourceLanguage")}
            <input className="mt-1 w-full rounded-md border border-outline bg-surface px-3 py-2 text-base" value={sourceLanguage} disabled={pending} onChange={(event) => setSourceLanguage(event.target.value)} placeholder="en" />
          </label>
          <label className="text-sm">{t("selectionTranslation.targetLanguage")}
            <input className="mt-1 w-full rounded-md border border-outline bg-surface px-3 py-2 text-base" value={targetLanguage} disabled={pending} onChange={(event) => setTargetLanguage(event.target.value)} placeholder="fr" />
          </label>
        </div>
        <p className="text-sm text-on-surface-variant">{t("selectionTranslation.languageHint")}</p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={allowCloud} disabled={pending} onChange={(event) => setAllowCloud(event.target.checked)} />
          {t("selectionTranslation.allowCloud")}
        </label>
        {pending && <p role="status" className="text-sm">{t("selectionTranslation.loading")}</p>}
        {error && <div role="alert" className="space-y-2 text-sm text-error"><p>{error}</p><p>{t("selectionTranslation.setupHint")}</p></div>}
        {result && <div role="status" className="space-y-3">
          <p className="whitespace-pre-wrap break-words" dir="auto">{result.translatedText}</p>
          <p className="text-sm text-on-surface-variant">{result.sourceLanguage} → {result.targetLanguage} · {result.providerId} · {result.provenance.privacy.description}</p>
        </div>}
      </div>
    </Dialog>
  );
}
