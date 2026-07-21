import { useState } from "react";
import { useI18n } from "../../lib/i18n";
import {
  resetOnboardingState,
  readOnboardingTourState,
  ONBOARDING_TOUR_LAUNCH_BUDGET,
} from "../../lib/onboardingTour";
import { tourAnchor } from "../onboarding/tour/anchors";

/**
 * Help & Tour settings surface. Hosts the on-demand tour entry points
 * required by spec ("Always available on demand"):
 *
 * - "Replay guided tour" — opens the tour from step 1 with progress reset,
 *   leaving launchCount/autoDisplayDisabled untouched.
 * - "Reset onboarding" — clears the launch counter, completion flag, and
 *   resume position; the next eligible launch behaves like a fresh install.
 *
 * Both dispatch window events that `MainLayout` listens for; the host does
 * the actual opening so this component stays free of tour internals.
 */
export function HelpSettings() {
  const { t } = useI18n();
  const [resetFlash, setResetFlash] = useState(false);

  const handleReplay = () => {
    window.dispatchEvent(new CustomEvent("tour-replay"));
  };

  const handleReset = () => {
    resetOnboardingState();
    setResetFlash(true);
    window.setTimeout(() => setResetFlash(false), 2400);
  };

  // Show the current budget state so the user knows where they stand before
  // resetting.
  const state = readOnboardingTourState();
  const budgetUsed = Math.min(state.launchCount, ONBOARDING_TOUR_LAUNCH_BUDGET);

  return (
    <div className="space-y-6">
      <SettingsSection title={t("onboarding.tour.replayTour")}>
        <SettingsRow label={t("onboarding.tour.replayTour")}>
          <button
            type="button"
            {...tourAnchor("settingsHelpReplayTour")}
            onClick={handleReplay}
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            {t("onboarding.tour.replayTour")}
          </button>
        </SettingsRow>
        <SettingsRow
          label={t("onboarding.tour.resetOnboarding")}
          description={t("onboarding.tour.resetOnboardingDesc")}
        >
          <button
            type="button"
            {...tourAnchor("settingsHelpResetOnboarding")}
            onClick={handleReset}
            className="px-3 py-1.5 rounded-md border border-border text-foreground text-sm font-medium hover:bg-muted"
          >
            {t("onboarding.tour.resetOnboarding")}
          </button>
          {resetFlash && (
            <span className="ml-2 text-xs text-muted-foreground">
              ✓ {budgetUsed}/3 → 0/3
            </span>
          )}
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

// Local mini-copies of the settings layout primitives so this component is
// self-contained and matches the styling used elsewhere in SettingsPage
// without pulling extra exports.
function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h3 className="text-lg font-semibold text-foreground mb-4">{title}</h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between py-4 border-b border-border last:border-0 gap-3 sm:gap-4">
      <div className="flex-1">
        <div className="font-medium text-foreground">{label}</div>
        {description && <div className="text-sm text-muted-foreground mt-1">{description}</div>}
      </div>
      <div className="flex items-center">{children}</div>
    </div>
  );
}
