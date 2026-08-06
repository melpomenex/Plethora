import { useMemo } from "react";
import { useI18n } from "../../../lib/i18n";
import { usePresentation } from "../../../contexts/PresentationContext";
import { useSettingsStore } from "../../../stores/settingsStore";
import { TOUR_CHAPTERS } from "./steps";
import { TourOverlay } from "./TourOverlay";
import { TourIllustration } from "./TourIllustration";
import {
  useOnboardingTour,
  type TourNavigationAdapter,
} from "./useOnboardingTour";

/**
 * Top-level guided-tour host. Mounted once in `MainLayout`. Owns the engine
 * instance for this session and renders the overlay when open.
 *
 * The host exposes an imperative API via the `tourControlRef` so other
 * surfaces (Settings replay button, command palette command, auto-open hook)
 * can open the tour without prop-drilling. The ref is stable across renders.
 */
export interface TourControl {
  /** Open the tour. `reset` clears saved progress and starts at step 1. */
  open: (opts?: { reset?: boolean }) => void;
  /** Close the tour with the given reason. */
  close: (reason: "done" | "skip" | "dismiss" | "manual") => void;
}

export type { TourNavigationAdapter };

export function TourHost({
  tourControlRef,
  adapter,
}: {
  tourControlRef: React.MutableRefObject<TourControl | null>;
  adapter: TourNavigationAdapter;
}) {
  const { t } = useI18n();
  const presentation = usePresentation();
  const isMobileShell = presentation.isMobileShell ?? false;
  const reducedMotion = presentation.reducedMotion ?? false;

  const api = useOnboardingTour(TOUR_CHAPTERS, adapter);

  // Publish the imperative API to the parent. Recomputed only when the
  // underlying callbacks change identity (they're memoised in the hook).
  useMemo(() => {
    tourControlRef.current = {
      open: api.openTour,
      close: api.close,
    };
  }, [api.openTour, api.close, tourControlRef]);

  if (!api.open || !api.currentStep) return null;

  const step = api.currentStep;
  const isFirst = api.isFirstStep;
  const isLast = api.isLastStep;

  return (
    <TourOverlay
      candidates={api.currentCandidates}
      placement={step.placement ?? "auto"}
      title={t(step.titleKey)}
      dialogId={`tour-step-${step.id}`}
      isMobileShell={isMobileShell}
      reducedMotion={reducedMotion}
      onBackdropClick={() => api.close("dismiss")}
      onEscape={() => api.close("dismiss")}
      rail={
        <ChapterRail
          chapters={api.chapters}
          activeChapterIndex={api.currentChapterIndex}
          furthestIndex={api.furthestIndex}
          currentIndex={api.currentIndex}
          totalSteps={api.totalSteps}
          onJump={api.jumpToChapter}
        />
      }
      footer={
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                className="tour-btn-skip"
                onClick={() => api.close("skip")}
                data-tour-key="skip"
              >
                {t("onboarding.tour.skip")}
              </button>
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--tour-muted)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  onChange={(e) => {
                    if (e.target.checked) {
                      useSettingsStore.getState().updateSettingsCategory("general", { showFeaturePopups: false });
                      api.close("skip");
                    }
                  }}
                  style={{ width: 12, height: 12 }}
                />
                {t("onboarding.tour.dontShowAgain") || "Don't show again"}
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {!isFirst && (
                <button
                  type="button"
                  onClick={api.back}
                  disabled={isFirst}
                  data-tour-key="back"
                >
                  {t("onboarding.tour.back")}
                </button>
              )}
              <button
                type="button"
                className="tour-btn-primary"
                onClick={() => (isLast ? api.close("done") : api.next())}
                data-tour-key="next"
              >
                {isLast ? t("onboarding.tour.done") : t("onboarding.tour.next")}
              </button>
            </div>
          </div>
        </>
      }
    >
      <TourIllustration kind={step.animation ?? "none"} />
      <p>{t(step.bodyKey)}</p>
      <p
        style={{
          fontSize: 12,
          color: "var(--tour-muted)",
          marginTop: 8,
        }}
      >
        {t("onboarding.tour.stepOf", {
          current: api.currentIndex + 1,
          total: api.totalSteps,
        })}
      </p>
    </TourOverlay>
  );
}

/**
 * The chapter rail. Renders one button per chapter; on mobile the CSS in
 * index.css collapses these to a dot indicator. Completed chapters (any
 * step already passed) are marked `is-done`, the current one `is-active`.
 */
function ChapterRail({
  chapters,
  activeChapterIndex,
  currentIndex,
  totalSteps,
  furthestIndex,
  onJump,
}: {
  chapters: ReturnType<typeof useOnboardingTour>["chapters"];
  activeChapterIndex: number;
  currentIndex: number;
  furthestIndex: number;
  totalSteps: number;
  onJump: (chapterIndex: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="tour-chapter-rail" role="tablist" aria-label="Tour chapters">
      {chapters.map((chapter, i) => {
        const isActive = i === activeChapterIndex;
        const isDone = i < activeChapterIndex || (i === activeChapterIndex && furthestIndex > currentIndex);
        return (
          <button
            key={chapter.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`tour-chapter ${isActive ? "is-active" : ""} ${isDone ? "is-done" : ""}`}
            onClick={() => onJump(i)}
          >
            {t(chapter.labelKey)}
          </button>
        );
      })}
      {/* Hidden counter for screen readers; visible progress is the step-of line in the body. */}
      <span aria-hidden="true" style={{ flex: 1 }} />
    </div>
  );
}
