import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChartBar,
  ChartLine,
  GraduationCap,
  Microphone,
  Package,
  PencilSimple,
  Stack,
  Translate,
} from "@phosphor-icons/react";
import { useLanguageProfileStore } from "../../stores/languageProfileStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils/cn";
import { LanguageOnboardingModal } from "./LanguageOnboardingModal";
import { LanguageDashboardView } from "./dashboard/LanguageDashboardView";
import { VocabularyManagerView } from "./dashboard/VocabularyManagerView";
import { LanguageContentHubView } from "./dashboard/LanguageContentHubView";
import { LanguagePracticeHubView } from "./dashboard/LanguagePracticeHubView";
import { LanguageAnalyticsView } from "./dashboard/LanguageAnalyticsView";
import { LanguageAssessmentPanel } from "./dashboard/LanguageAssessmentPanel";
import { LanguagePacksView } from "./dashboard/LanguagePacksView";

type LanguageSubView = "today" | "vocabulary" | "content" | "practice" | "analytics" | "assessment" | "packs";

const SUBVIEWS: ReadonlyArray<{ id: LanguageSubView; labelKey: string; icon: React.ElementType }> = [
  { id: "today", labelKey: "languageLearning.dashboard.today", icon: GraduationCap },
  { id: "vocabulary", labelKey: "languageLearning.dashboard.vocabulary", icon: Stack },
  { id: "content", labelKey: "languageLearning.dashboard.content", icon: PencilSimple },
  { id: "practice", labelKey: "languageLearning.dashboard.practice", icon: Microphone },
  { id: "analytics", labelKey: "languageLearning.dashboard.analytics", icon: ChartBar },
  { id: "assessment", labelKey: "languageLearning.dashboard.assessment", icon: ChartLine },
  { id: "packs", labelKey: "languageLearning.dashboard.packs", icon: Package },
];

function renderSubview(view: LanguageSubView) {
  switch (view) {
    case "today":
      return <LanguageDashboardView />;
    case "vocabulary":
      return <VocabularyManagerView />;
    case "content":
      return <LanguageContentHubView />;
    case "practice":
      return <LanguagePracticeHubView />;
    case "analytics":
      return <LanguageAnalyticsView />;
    case "assessment":
      return <LanguageAssessmentPanel />;
    case "packs":
      return <LanguagePacksView />;
  }
}

/** User-facing label for a sub-view id (kept in one switch for i18n). */
function subviewTitle(view: LanguageSubView, t: (key: string) => string): string {
  switch (view) {
    case "today":
      return t("languageLearning.dashboard.today");
    case "vocabulary":
      return t("languageLearning.dashboard.vocabulary");
    case "content":
      return t("languageLearning.dashboard.content");
    case "practice":
      return t("languageLearning.dashboard.practice");
    case "analytics":
      return t("languageLearning.dashboard.analytics");
    case "assessment":
      return t("languageLearning.dashboard.assessment");
    case "packs":
      return t("languageLearning.dashboard.packs");
  }
}

/**
 * First-class Language Learning workspace tab. It is intentionally lazy-loaded
 * by the tab shell and never gates on `settings.languageLearning.enabled`:
 * opening the tab is an explicit opt-in that preserves the strict default for
 * document-reader mounting (see `DocumentViewerWrapper`).
 */
export function LanguageLearningTab() {
  const { t } = useI18n();
  const [view, setView] = useState<LanguageSubView>("today");
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  const profiles = useLanguageProfileStore((state) => state.profiles);
  const activeProfile = useLanguageProfileStore((state) => state.activeProfile);
  const loaded = useLanguageProfileStore((state) => state.loaded);
  const loading = useLanguageProfileStore((state) => state.loading);
  const loadProfiles = useLanguageProfileStore((state) => state.load);
  const setActiveProfile = useLanguageProfileStore((state) => state.setActiveProfile);

  const languageSettings = useSettingsStore((state) => state.settings.languageLearning);

  useEffect(() => {
    if (!loaded && !loading) void loadProfiles();
  }, [loaded, loading, loadProfiles]);

  const hasProfile = profiles.length > 0;

  const openOnboarding = useCallback(() => setOnboardingOpen(true), []);

  const handleProfileChange = useCallback(
    (profileId: string) => {
      if (profileId !== activeProfile?.id) void setActiveProfile(profileId);
    },
    [activeProfile?.id, setActiveProfile],
  );

  const activeProfileId = activeProfile?.id ?? profiles[0]?.id ?? null;

  const header = useMemo(() => {
    if (!hasProfile) {
      return (
        <button
          type="button"
          onClick={openOnboarding}
          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset ring-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-colors"
        >
          <Translate className="w-4 h-4" />
          {t("languageLearning.startLearning")}
        </button>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <label className="text-xs text-stone-400" htmlFor="language-active-profile">
          {t("languageLearning.activeProfile")}
        </label>
        <select
          id="language-active-profile"
          value={activeProfileId ?? ""}
          onChange={(event) => handleProfileChange(event.target.value)}
          className="rounded-md bg-stone-800 text-sm text-stone-100 ring-1 ring-inset ring-stone-700 px-2 py-1.5 focus:outline-none focus:ring-emerald-500"
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name} · {profile.targetLanguage}
            </option>
          ))}
        </select>
      </div>
    );
  }, [hasProfile, profiles, activeProfileId, handleProfileChange, openOnboarding, t]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-stone-950 text-stone-100">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Translate className="w-5 h-5 text-emerald-400" weight="bold" />
          <h1 className="text-base font-semibold">{t("languageLearning.title")}</h1>
        </div>
        {header}
      </div>

      {hasProfile ? (
        <>
          <div className="flex flex-wrap items-center gap-1 border-b border-stone-800 px-4 py-2">
            {SUBVIEWS.map(({ id, labelKey, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                  view === id
                    ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/40"
                    : "text-stone-400 hover:bg-stone-800 hover:text-stone-200",
                )}
              >
                <Icon className="w-4 h-4" />
                {t(labelKey)}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {renderSubview(view)}
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/30">
            <Translate className="h-8 w-8 text-emerald-400" weight="bold" />
          </div>
          <h2 className="max-w-md text-lg font-semibold">{t("languageLearning.landing.title")}</h2>
          <p className="max-w-md text-sm text-stone-400">{t("languageLearning.landing.description")}</p>
          <button
            type="button"
            onClick={openOnboarding}
            className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors"
          >
            {t("languageLearning.startLearning")}
          </button>
        </div>
      )}

      {onboardingOpen ? <LanguageOnboardingModal onClose={() => setOnboardingOpen(false)} /> : null}
    </div>
  );
}
