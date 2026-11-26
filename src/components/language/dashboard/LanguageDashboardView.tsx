import { useCallback, useEffect, useState } from "react";
import { BookOpen, Clock, ListBullets, WarningCircle } from "@phosphor-icons/react";
import { useLanguageProfileStore } from "../../../stores/languageProfileStore";
import { useI18n } from "../../../lib/i18n";
import { getLanguageProfileAssociations } from "../../../api/languageProfiles";
import { listLanguageLexicalEntries, listLanguageLookupEvents } from "../../../api/languageLexicon";
import { listLanguagePracticeAttempts } from "../../../api/languagePractice";
import { createCanonicalTab } from "../../tabs/TabRegistry";
import { useTabsStore } from "../../../stores";

interface TodayData {
  totalEntries: number | null;
  recentLookups: Awaited<ReturnType<typeof listLanguageLookupEvents>>;
  recentAttempts: Awaited<ReturnType<typeof listLanguagePracticeAttempts>>;
  associations: Awaited<ReturnType<typeof getLanguageProfileAssociations>>;
}

/** Today overview for the Language Learning workspace, using honest real data. */
export function LanguageDashboardView() {
  const { t } = useI18n();
  const activeProfile = useLanguageProfileStore((state) => state.activeProfile);
  const profileId = activeProfile?.id ?? null;

  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profileId) return;
    let current = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      listLanguageLexicalEntries(profileId, { limit: 1 }).then((page) => page.total).catch(() => null),
      listLanguageLookupEvents(profileId, { limit: 5 }).catch(() => ({ items: [], offset: 0, limit: 5, total: 0, hasMore: false })),
      listLanguagePracticeAttempts(profileId, { limit: 5 }).catch(() => []),
      getLanguageProfileAssociations({ profileId }).catch(() => []),
    ])
      .then(([totalEntries, recentLookups, recentAttempts, associations]) => {
        if (current) setData({ totalEntries, recentLookups, recentAttempts, associations });
      })
      .catch((cause) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [profileId]);

  const openDocuments = useCallback(() => {
    useTabsStore.getState().addTab(createCanonicalTab("documents"), undefined, "bootstrap");
    window.dispatchEvent(new CustomEvent("navigate", { detail: "/documents" }));
  }, []);

  if (loading) {
    return <div className="p-6 text-sm text-stone-400">{t("languageLearning.loading")}</div>;
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-red-400">
        <WarningCircle className="h-4 w-4" />
        {error}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-5">
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-stone-300">
          <ListBullets className="h-4 w-4 text-emerald-400" />
          {t("languageLearning.today.overview")}
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl bg-stone-800/60 p-4 ring-1 ring-inset ring-stone-700/60">
            <div className="text-xs text-stone-400">{t("languageLearning.today.lexicon")}</div>
            <div className="mt-1 text-xl font-semibold text-stone-100">
              {data?.totalEntries !== null ? String(data?.totalEntries ?? 0) : t("languageLearning.unavailable")}
            </div>
          </div>
          <div className="rounded-xl bg-stone-800/60 p-4 ring-1 ring-inset ring-stone-700/60">
            <div className="text-xs text-stone-400">{t("languageLearning.today.associations")}</div>
            <div className="mt-1 text-xl font-semibold text-stone-100">{String(data?.associations.length ?? 0)}</div>
          </div>
          <div className="rounded-xl bg-stone-800/60 p-4 ring-1 ring-inset ring-stone-700/60">
            <div className="text-xs text-stone-400">{t("languageLearning.today.recentLookups")}</div>
            <div className="mt-1 text-xl font-semibold text-stone-100">{String(data?.recentLookups.items.length ?? 0)}</div>
          </div>
          <div className="rounded-xl bg-stone-800/60 p-4 ring-1 ring-inset ring-stone-700/60">
            <div className="text-xs text-stone-400">{t("languageLearning.today.recentPractice")}</div>
            <div className="mt-1 text-xl font-semibold text-stone-100">{String(data?.recentAttempts.length ?? 0)}</div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-stone-300">
          <BookOpen className="h-4 w-4 text-emerald-400" />
          {t("languageLearning.today.continueReading")}
        </h3>
        {!data || data.associations.length === 0 ? (
          <button type="button" onClick={openDocuments} className="w-full rounded-lg bg-stone-800/60 p-4 text-left text-sm text-stone-400 ring-1 ring-inset ring-stone-700/60 hover:bg-stone-800">
            {t("languageLearning.today.noAssociations")}
          </button>
        ) : (
          <ul className="divide-y divide-stone-800 rounded-xl ring-1 ring-inset ring-stone-800 bg-stone-900/40">
            {data.associations.slice(0, 5).map((association) => (
              <li key={`${association.contentType}:${association.contentId}`} className="px-4 py-3">
                <div className="text-sm text-stone-200">{association.contentId}</div>
                <div className="mt-0.5 text-xs text-stone-500">{association.contentType} · {association.mode}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-stone-300">
          <Clock className="h-4 w-4 text-emerald-400" />
          {t("languageLearning.today.recentActivity")}
        </h3>
        {!data || (data.recentLookups.items.length === 0 && data.recentAttempts.length === 0) ? (
          <p className="rounded-lg bg-stone-800/60 p-4 text-sm text-stone-400 ring-1 ring-inset ring-stone-700/60">
            {t("languageLearning.today.noActivity")}
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg bg-stone-800/60 p-4 ring-1 ring-inset ring-stone-700/60">
              <div className="text-xs font-medium text-stone-400">{t("languageLearning.today.vocabulary")}</div>
              <ul className="mt-2 space-y-1.5">
                {data.recentLookups.items.slice(0, 4).map((lookup) => (
                  <li key={lookup.id} className="text-sm text-stone-300">{lookup.surface}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg bg-stone-800/60 p-4 ring-1 ring-inset ring-stone-700/60">
              <div className="text-xs font-medium text-stone-400">{t("languageLearning.today.practice")}</div>
              <ul className="mt-2 space-y-1.5">
                {data.recentAttempts.slice(0, 4).map((attempt) => (
                  <li key={attempt.id} className="flex items-center justify-between text-sm text-stone-300">
                    <span>{t(`languageLearning.practice.modeName.${attempt.mode}`)}</span>
                    {attempt.comparison?.score != null ? (
                      <span className="text-xs text-stone-500">{Math.round(attempt.comparison.score * 100)}%</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
