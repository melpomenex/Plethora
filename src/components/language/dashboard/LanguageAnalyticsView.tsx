import { useEffect, useMemo, useState } from "react";
import { ChartBar, WarningCircle } from "@phosphor-icons/react";
import { useLanguageProfileStore } from "../../../stores/languageProfileStore";
import { useI18n } from "../../../lib/i18n";
import { loadLanguageAnalyticsDashboardData, type LanguageAnalyticsDashboardData } from "../../../lib/languageAnalytics";

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

/** Analytics availability uses the evidence-status ladder: ready/stale = usable. */
function isAvailable(status: string | undefined): boolean {
  return status === "ready" || status === "stale";
}

function StatCard(props: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-inset ring-border">
      <div className="text-xs text-muted-foreground">{props.label}</div>
      <div className="mt-1 text-xl font-semibold text-foreground">{props.value}</div>
      {props.hint ? <div className="mt-1 text-xs text-muted-foreground">{props.hint}</div> : null}
    </div>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{props.title}</h3>
      {props.children}
    </section>
  );
}

/** Honest, evidence-backed Language Analytics view built on the shared analytics service. */
export function LanguageAnalyticsView() {
  const { t } = useI18n();
  const activeProfile = useLanguageProfileStore((state) => state.activeProfile);
  const [data, setData] = useState<LanguageAnalyticsDashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profileId = activeProfile?.id ?? null;

  useEffect(() => {
    if (!profileId) return;
    let current = true;
    setLoading(true);
    setError(null);
    setData(null);
    loadLanguageAnalyticsDashboardData(profileId)
      .then((result) => {
        if (current) setData(result);
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

  const summary = useMemo(() => {
    if (!data) return null;
    const vocab = data.vocabulary;
    const practice = data.activity.practice;
    const reading = data.activity.reading;
    const listening = data.activity.listening;
    const coverage = data.coverage;
    return {
      lemmas: isAvailable(vocab.status) ? vocab.lemmas.known + vocab.lemmas.learning + vocab.lemmas.new : null,
      known: isAvailable(vocab.status) ? vocab.lemmas.known : null,
      learning: isAvailable(vocab.status) ? vocab.lemmas.learning : null,
      practiceAttempts: isAvailable(practice.status) ? practice.totalAttempts : null,
      practiceScore: isAvailable(practice.status) ? practice.averageScore : null,
      readingSessions: isAvailable(reading.status) ? reading.sessions : null,
      listeningSessions: isAvailable(listening.status) ? listening.sessions : null,
      coverageRatio: isAvailable(coverage.status) ? coverage.averageCoverageRatio : null,
      coverageReady: isAvailable(coverage.status) ? coverage.readyDocuments : null,
    };
  }, [data]);

  const unavailable = (status: string | undefined) => !isAvailable(status);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">{t("languageLearning.loading")}</div>;
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-destructive">
        <WarningCircle className="h-4 w-4" />
        {error}
      </div>
    );
  }
  if (!summary) {
    return <div className="p-6 text-sm text-muted-foreground">{t("languageLearning.empty")}</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label={t("languageLearning.analytics.knownLemma")} value={summary.known !== null ? String(summary.known) : t("languageLearning.unavailable")} />
        <StatCard label={t("languageLearning.analytics.learningLemma")} value={summary.learning !== null ? String(summary.learning) : t("languageLearning.unavailable")} />
        <StatCard label={t("languageLearning.analytics.practiceAttempts")} value={summary.practiceAttempts !== null ? String(summary.practiceAttempts) : t("languageLearning.unavailable")} />
        <StatCard label={t("languageLearning.analytics.avgScore")} value={summary.practiceScore !== null ? `${Math.round(summary.practiceScore * 100)}%` : t("languageLearning.unavailable")} />
        <StatCard label={t("languageLearning.analytics.readingSessions")} value={summary.readingSessions !== null ? String(summary.readingSessions) : t("languageLearning.unavailable")} />
        <StatCard label={t("languageLearning.analytics.listeningSessions")} value={summary.listeningSessions !== null ? String(summary.listeningSessions) : t("languageLearning.unavailable")} />
        <StatCard label={t("languageLearning.analytics.coverage")} value={summary.coverageRatio !== null ? formatPercent(summary.coverageRatio) : t("languageLearning.unavailable")} />
        <StatCard label={t("languageLearning.analytics.readyDocuments")} value={summary.coverageReady !== null ? String(summary.coverageReady) : t("languageLearning.unavailable")} />
      </div>

      {data ? (
        <>
          <Section title={t("languageLearning.analytics.reading")}>
            {unavailable(data.activity.reading.status) ? (
              <p className="text-sm text-muted-foreground">{data.activity.reading.reason ?? t("languageLearning.analytics.noReadingEvidence")}</p>
            ) : (
              <p className="text-sm text-foreground">
                {t("languageLearning.analytics.readingTokens", { count: String(data.activity.reading.tokens ?? 0) })}
              </p>
            )}
          </Section>

          <Section title={t("languageLearning.analytics.listening")}>
            {unavailable(data.activity.listening.status) ? (
              <p className="text-sm text-muted-foreground">{data.activity.listening.reason ?? t("languageLearning.analytics.noListeningEvidence")}</p>
            ) : (
              <p className="text-sm text-foreground">
                {t("languageLearning.analytics.listeningSentences", { count: String(data.activity.listening.sentences ?? 0) })}
              </p>
            )}
          </Section>

          <Section title={t("languageLearning.analytics.practice")}>
            {unavailable(data.activity.practice.status) ? (
              <p className="text-sm text-muted-foreground">{data.activity.practice.reason ?? t("languageLearning.analytics.noPracticeEvidence")}</p>
            ) : (
              <div className="space-y-2 text-sm text-foreground">
                <p>{t("languageLearning.analytics.submitted", { count: String(data.activity.practice.submittedAttempts) })}</p>
                <p>{t("languageLearning.analytics.accepted", { count: String(data.activity.practice.acceptedActiveAttempts) })}</p>
                <p>{t("languageLearning.analytics.errors", { count: String(data.activity.practice.totalErrors) })}</p>
              </div>
            )}
          </Section>

          <Section title={t("languageLearning.analytics.coverageSection")}>
            {unavailable(data.coverage.status) ? (
              <p className="text-sm text-muted-foreground">{data.coverage.reason ?? t("languageLearning.analytics.noCoverage")}</p>
            ) : (
              <div className="space-y-2 text-sm text-foreground">
                <p>{t("languageLearning.analytics.coverageReady", { count: String(data.coverage.readyDocuments) })}</p>
                <p>{t("languageLearning.analytics.unknownDensity", { value: formatPercent(data.coverage.averageUnknownDensity) })}</p>
              </div>
            )}
          </Section>

          {data.proficiency.status === "unavailable" ? (
            <Section title={t("languageLearning.analytics.proficiency")}>
              <div className="flex items-start gap-2 rounded-lg bg-card p-3 ring-1 ring-inset ring-border">
                <ChartBar className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{data.proficiency.reason ?? t("languageLearning.analytics.noProficiency")}</p>
              </div>
            </Section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
