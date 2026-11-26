import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { listLanguageLexicalEntries } from "../../api/languageLexicon";
import { listLanguagePracticeAttempts } from "../../api/languagePractice";
import { getAllLearningItems } from "../../api/learning-items";
import { useLanguageProfileStore } from "../../stores/languageProfileStore";
import { useTabsStore } from "../../stores/tabsStore";
import { createCanonicalTab } from "../tabs/TabRegistry";
import {
  inferGapRecommendations,
  type GapRecommendation,
} from "../../lib/studyPlans/gapRecommendations";
import type { StudyPlanDetail } from "../../types/learningPaths";

interface LearnerEvidenceSectionProps {
  planDetail: StudyPlanDetail;
}

function openLanguageLearningTab(): void {
  useTabsStore.getState().addTab(createCanonicalTab("language-learning"));
}

export function LearnerEvidenceSection({ planDetail }: LearnerEvidenceSectionProps) {
  const { t } = useI18n();
  const profileId = planDetail.plan.languageProfileId ?? null;
  const targetLanguage = useLanguageProfileStore((state) => state.activeProfile?.targetLanguage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<GapRecommendation[]>([]);

  const nodes = useMemo(
    () => planDetail.version.nodes.map((node) => ({
      nodeId: node.nodeId,
      title: node.title,
      objectives: node.learningObjectives,
      included: node.included,
      activity: planDetail.activityByNodeId[node.nodeId] ?? "not-started",
      sourceRefCount: node.sourceRefIds.length,
      materialSupport: node.materialSupport,
    })),
    [planDetail],
  );

  useEffect(() => {
    if (!profileId) {
      setRecommendations([]);
      return;
    }
    let disposed = false;
    setLoading(true);
    setError(null);
    Promise.all([
      listLanguageLexicalEntries(profileId, { languageTag: targetLanguage, offset: 0, limit: 500 })
        .then((page) => page.items.map((entry) => ({
          canonicalForm: entry.canonicalForm,
          normalizedForm: entry.normalizedForm,
          state: entry.knowledgeState ?? "",
          passiveEvidenceCount: entry.passiveEvidenceCount,
          activeEvidenceCount: entry.activeEvidenceCount,
        })))
        .catch(() => []),
      listLanguagePracticeAttempts(profileId)
        .then((attempts) => {
          const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
          const accepted = attempts.filter((attempt) => attempt.activeEvidenceAccepted && attempt.createdAt >= cutoff);
          return {
            acceptedAttempts14d: accepted.length,
            acceptedByMode: accepted.reduce<Record<string, number>>((map, attempt) => {
              map[attempt.mode] = (map[attempt.mode] ?? 0) + 1;
              return map;
            }, {}),
          };
        })
        .catch(() => ({ acceptedAttempts14d: 0, acceptedByMode: {} })),
      getAllLearningItems()
        .then((items) => items.filter((item) =>
          item.interaction_metadata?.languageProfileId === profileId
          || item.interaction_metadata?.languageProvenance?.profileId === profileId
        ).length)
        .catch(() => 0),
    ]).then(([lexicon, practice, itemCount]) => {
      if (disposed) return;
      setRecommendations(inferGapRecommendations({ nodes, lexicon, practice, flashcard: { itemCount } }));
      setLoading(false);
    }).catch(() => {
      if (disposed) return;
      setError(t("studyPlans.gaps.error"));
      setLoading(false);
    });
    return () => {
      disposed = true;
    };
  }, [profileId, targetLanguage, nodes, t]);

  if (!profileId) return null;

  return (
    <section
      aria-labelledby="learner-evidence-heading"
      className="rounded-xl border border-border p-4"
      data-learner-evidence="true"
    >
      <h2 id="learner-evidence-heading" className="text-sm font-semibold text-foreground">
        {t("studyPlans.gaps.heading")}
      </h2>
      {loading ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("studyPlans.gaps.loading")}</p>
      ) : error ? (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      ) : recommendations.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("studyPlans.gaps.none")}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {recommendations.map((recommendation) => (
            <li
              key={recommendation.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-xs"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{t(recommendation.titleKey)}</p>
                <p className="truncate text-muted-foreground">
                  {t(recommendation.detailKey, { count: recommendation.count ?? 0 })}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
                onClick={openLanguageLearningTab}
              >
                {t("studyPlans.gaps.openLanguage")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
