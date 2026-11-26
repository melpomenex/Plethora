import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Translate, X } from "@phosphor-icons/react";
import { useLanguageProfileStore } from "../../stores/languageProfileStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils/cn";
import { createCanonicalTab } from "../tabs/TabRegistry";
import { useTabsStore } from "../../stores";
import { filterCatalogPacks, getStarterPackEntries, LANGUAGE_PACK_CATALOG } from "../../lib/languagePacks/catalog";
import { installLanguagePackWithEntries, type LanguageDictionaryEntryRecord, type LanguagePackRecord } from "../../api/languagePacks";
import { isTauri } from "../../lib/tauri";

export interface LanguageOnboardingModalProps {
  onClose: () => void;
}

const TARGET_LANGUAGES: ReadonlyArray<{ tag: string; label: string }> = [
  { tag: "en", label: "English" },
  { tag: "es", label: "Spanish" },
  { tag: "fr", label: "French" },
  { tag: "de", label: "German" },
  { tag: "ja", label: "Japanese" },
  { tag: "zh", label: "Chinese (Mandarin)" },
  { tag: "ko", label: "Korean" },
  { tag: "ar", label: "Arabic" },
  { tag: "pt", label: "Portuguese" },
  { tag: "it", label: "Italian" },
  { tag: "nl", label: "Dutch" },
  { tag: "ru", label: "Russian" },
];

const PROFICIENCY_LEVELS = ["beginner", "intermediate", "advanced", "native"] as const;

const STEP_COUNT = 8;

function stepTitle(step: number, t: (key: string) => string): string {
  switch (step) {
    case 0:
      return t("languageLearning.onboarding.welcome.title");
    case 1:
      return t("languageLearning.onboarding.languages.title");
    case 2:
      return t("languageLearning.onboarding.proficiency.title");
    case 3:
      return t("languageLearning.onboarding.offline.title");
    case 4:
      return t("languageLearning.onboarding.pack.title");
    case 5:
      return t("languageLearning.onboarding.ai.title");
    case 6:
      return t("languageLearning.onboarding.import.title");
    default:
      return t("languageLearning.onboarding.review.title");
  }
}

/**
 * Skippable 8-step guided onboarding. It creates a language profile, enables
 * the Language Learning mode, and optionally installs a starter dictionary
 * pack (best-effort, never blocking profile creation).
 */
export function LanguageOnboardingModal({ onClose }: LanguageOnboardingModalProps) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [targetLanguage, setTargetLanguage] = useState("es");
  const [baseLanguage, setBaseLanguage] = useState("en");
  const [proficiency, setProficiency] = useState<(typeof PROFICIENCY_LEVELS)[number]>("beginner");
  const [installPack, setInstallPack] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createProfile = useLanguageProfileStore((state) => state.createProfile);
  const setActiveProfile = useLanguageProfileStore((state) => state.setActiveProfile);
  const updateSettingsCategory = useSettingsStore((state) => state.updateSettingsCategory);

  const targetLabel = useMemo(
    () => TARGET_LANGUAGES.find((entry) => entry.tag === targetLanguage)?.label ?? targetLanguage,
    [targetLanguage],
  );

  const starterPackAvailable = useMemo(() => {
    const manifest = filterCatalogPacks(LANGUAGE_PACK_CATALOG, { languageTag: targetLanguage })[0];
    return manifest ? getStarterPackEntries(manifest.id) !== null : false;
  }, [targetLanguage]);

  useEffect(() => {
    if (step === 3 && !starterPackAvailable) setInstallPack(false);
  }, [step, starterPackAvailable]);

  const openSettingsTab = useCallback(() => {
    useTabsStore.getState().addTab(createCanonicalTab("settings"));
  }, []);

  const openDocumentsTab = useCallback(() => {
    useTabsStore.getState().addTab(createCanonicalTab("documents"));
  }, []);

  const finish = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const profile = await createProfile({
        name: `${targetLabel} learner`,
        targetLanguage,
        baseLanguage,
        proficiency,
      });
      await setActiveProfile(profile.id);
      updateSettingsCategory("languageLearning", { enabled: true });

      // Best-effort starter dictionary pack install (offline).
      if (installPack) {
        const manifest = filterCatalogPacks(LANGUAGE_PACK_CATALOG, { languageTag: targetLanguage })[0];
        if (manifest) {
          const entries = getStarterPackEntries(manifest.id);
          if (entries && entries.length > 0) {
            try {
              const packRecord: LanguagePackRecord = {
                id: manifest.id,
                languageTag: manifest.languageTag,
                targetLanguage: manifest.targetLanguage,
                baseLanguage: manifest.baseLanguage,
                name: manifest.name,
                kind: manifest.kind,
                format: manifest.format,
                version: manifest.version,
                sourceUrl: manifest.homepageUrl ?? manifest.downloadUrl,
                sha256: manifest.sha256,
                sizeBytes: manifest.sizeBytes,
                entryCount: entries.length,
                license: manifest.license,
                attribution: manifest.attribution,
                capabilities: manifest.capabilities as unknown as Record<string, unknown>,
                status: "installed",
                installedAt: Date.now(),
                updatedAt: Date.now(),
              };
              const records: LanguageDictionaryEntryRecord[] = entries.map((entry) => ({
                id: `${manifest.id}:${entry.normalizedHeadword}`,
                packId: manifest.id,
                languageTag: manifest.languageTag,
                headword: entry.headword,
                normalizedHeadword: entry.normalizedHeadword,
                reading: entry.reading,
                lemma: entry.lemma,
                partOfSpeech: entry.pos,
                morphology: entry.morphology ?? {},
                senses: entry.senses.map((sense) => ({
                  definition: typeof sense.definition === "string" ? sense.definition : String(sense.definition),
                  glosses: sense.glosses,
                  tags: sense.tags,
                })),
                examples: entry.examples ?? [],
                frequencyRank: entry.frequencyRank,
              }));
              if (isTauri()) {
                await installLanguagePackWithEntries(packRecord, records);
              }
            } catch {
              // Starter pack install is best-effort; never block onboarding.
            }
          }
        }
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [createProfile, setActiveProfile, updateSettingsCategory, installPack, onClose, proficiency, baseLanguage, targetLanguage, targetLabel]);

  const canAdvance = step !== 1 || targetLanguage.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={t("languageLearning.onboarding.title")}>
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-stone-900 ring-1 ring-inset ring-stone-700 shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-800 px-5 py-3">
          <div className="flex items-center gap-2">
            <Translate className="h-5 w-5 text-emerald-400" weight="bold" />
            <h2 className="text-sm font-semibold">{t("languageLearning.onboarding.title")}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="rounded-full p-1.5 text-stone-400 hover:bg-stone-800 hover:text-stone-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1 px-5 pt-4">
          {Array.from({ length: STEP_COUNT }, (_, index) => (
            <div
              key={index}
              className={cn("h-1 flex-1 rounded-full transition-colors", index <= step ? "bg-emerald-500" : "bg-stone-700")}
            />
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <h3 className="text-base font-semibold">{stepTitle(step, t)}</h3>

          {step === 0 && (
            <div className="mt-3 space-y-2 text-sm text-stone-300">
              <p>{t("languageLearning.onboarding.welcome.body1")}</p>
              <p>{t("languageLearning.onboarding.welcome.body2")}</p>
            </div>
          )}

          {step === 1 && (
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-stone-400" htmlFor="onboarding-target">
                  {t("languageLearning.onboarding.languages.target")}
                </label>
                <select id="onboarding-target" value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)} className="w-full rounded-md bg-stone-800 px-3 py-2 text-sm text-stone-100 ring-1 ring-inset ring-stone-700 focus:outline-none focus:ring-emerald-500">
                  {TARGET_LANGUAGES.map((entry) => (
                    <option key={entry.tag} value={entry.tag}>{entry.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-stone-400" htmlFor="onboarding-base">
                  {t("languageLearning.onboarding.languages.base")}
                </label>
                <select id="onboarding-base" value={baseLanguage} onChange={(event) => setBaseLanguage(event.target.value)} className="w-full rounded-md bg-stone-800 px-3 py-2 text-sm text-stone-100 ring-1 ring-inset ring-stone-700 focus:outline-none focus:ring-emerald-500">
                  {TARGET_LANGUAGES.map((entry) => (
                    <option key={entry.tag} value={entry.tag}>{entry.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {PROFICIENCY_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setProficiency(level)}
                  className={cn(
                    "rounded-lg px-3 py-2.5 text-sm font-medium ring-1 ring-inset transition-colors",
                    proficiency === level
                      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40"
                      : "bg-stone-800 text-stone-300 ring-stone-700 hover:bg-stone-700",
                  )}
                >
                  {t(`languageLearning.onboarding.proficiency.${level}`)}
                </button>
              ))}
            </div>
          )}

          {step === 3 && (
            <ul className="mt-4 space-y-2 text-sm text-stone-300">
              <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />{t("languageLearning.onboarding.offline.1")}</li>
              <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />{t("languageLearning.onboarding.offline.2")}</li>
              <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />{t("languageLearning.onboarding.offline.3")}</li>
              <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />{t("languageLearning.onboarding.offline.4")}</li>
              <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />{t("languageLearning.onboarding.offline.5")}</li>
            </ul>
          )}

          {step === 4 && (
            <div className="mt-4 space-y-3">
              <label className="flex items-start gap-3 rounded-lg bg-stone-800 p-3 ring-1 ring-inset ring-stone-700">
                <input type="checkbox" checked={installPack && starterPackAvailable} disabled={!starterPackAvailable} onChange={(event) => setInstallPack(event.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-500" />
                <span className="text-sm text-stone-200">
                  {t("languageLearning.onboarding.pack.body", { language: targetLabel })}
                  {!starterPackAvailable ? <span className="block text-xs text-stone-400">{t("languageLearning.onboarding.pack.unavailable")}</span> : null}
                </span>
              </label>
              <p className="text-xs text-stone-400">{t("languageLearning.onboarding.pack.note")}</p>
            </div>
          )}

          {step === 5 && (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-stone-300">{t("languageLearning.onboarding.ai.body")}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={openSettingsTab} className="rounded-full bg-stone-800 px-4 py-2 text-sm font-medium text-stone-200 ring-1 ring-inset ring-stone-700 hover:bg-stone-700">
                  {t("languageLearning.onboarding.ai.openSettings")}
                </button>
                <button type="button" onClick={() => setStep(step + 1)} className="rounded-full bg-stone-800 px-4 py-2 text-sm font-medium text-stone-200 ring-1 ring-inset ring-stone-700 hover:bg-stone-700">
                  {t("languageLearning.onboarding.skip")}
                </button>
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-stone-300">{t("languageLearning.onboarding.import.body")}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={openDocumentsTab} className="rounded-full bg-stone-800 px-4 py-2 text-sm font-medium text-stone-200 ring-1 ring-inset ring-stone-700 hover:bg-stone-700">
                  {t("languageLearning.onboarding.import.browse")}
                </button>
                <button type="button" onClick={() => setStep(step + 1)} className="rounded-full bg-stone-800 px-4 py-2 text-sm font-medium text-stone-200 ring-1 ring-inset ring-stone-700 hover:bg-stone-700">
                  {t("languageLearning.onboarding.skip")}
                </button>
              </div>
            </div>
          )}

          {step === 7 && (
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-lg bg-stone-800 px-3 py-2.5">
                <dt className="text-stone-400">{t("languageLearning.onboarding.review.language")}</dt>
                <dd className="font-medium text-stone-100">{targetLabel}</dd>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-stone-800 px-3 py-2.5">
                <dt className="text-stone-400">{t("languageLearning.onboarding.review.proficiency")}</dt>
                <dd className="font-medium text-stone-100">{t(`languageLearning.onboarding.proficiency.${proficiency}`)}</dd>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-stone-800 px-3 py-2.5">
                <dt className="text-stone-400">{t("languageLearning.onboarding.review.pack")}</dt>
                <dd className="font-medium text-stone-100">{installPack && starterPackAvailable ? t("common.yes") : t("common.no")}</dd>
              </div>
            </dl>
          )}

          {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between border-t border-stone-800 px-5 py-3">
          <button
            type="button"
            onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-stone-300 hover:bg-stone-800"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("common.back")}
          </button>
          {step < STEP_COUNT - 1 ? (
            <button
              type="button"
              disabled={!canAdvance}
              onClick={() => setStep(step + 1)}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white enabled:hover:bg-emerald-500 disabled:opacity-40"
            >
              {t("common.next")}
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void finish()}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white enabled:hover:bg-emerald-500 disabled:opacity-40"
            >
              {busy ? t("languageLearning.onboarding.review.creating") : t("languageLearning.onboarding.review.launch")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
