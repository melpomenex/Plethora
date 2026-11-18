import { ArrowRight, Compass, GraduationCap, Lightning, Plus, Sparkle } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { useSurfaceMenu } from "../../hooks/useSurfaceMenu";
import { ContextMenu, ContextMenuItemType, type ContextMenuItem } from "../common/ContextMenu";

export interface TodaysHorizonBannerProps {
  activePlansCount: number;
  upcomingNodesCount?: number;
  nextMilestoneTitle?: string | null;
  pendingAssessmentsCount: number;
  dueReviewsCount: number;
  highPriorityExtractsCount: number;
  unreadDiscoveryCount?: number;
  onResumeMilestone: () => void;
  onLaunchQueue: () => void;
  onCreateStudyPlan?: () => void;
}

export function TodaysHorizonBanner({
  activePlansCount,
  upcomingNodesCount = 0,
  nextMilestoneTitle,
  pendingAssessmentsCount,
  dueReviewsCount,
  highPriorityExtractsCount,
  unreadDiscoveryCount = 0,
  onResumeMilestone,
  onLaunchQueue,
  onCreateStudyPlan,
}: TodaysHorizonBannerProps) {
  const { t } = useI18n();
  const horizonMenu = useSurfaceMenu("todays-horizon-menu");
  const hasTopDown = activePlansCount > 0 || pendingAssessmentsCount > 0;
  const hasBottomUp = dueReviewsCount > 0 || highPriorityExtractsCount > 0 || unreadDiscoveryCount > 0;

  const topDownPrimaryAction = hasTopDown ? onResumeMilestone : (onCreateStudyPlan ?? onResumeMilestone);

  const buildTopDownItems = (): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      {
        id: hasTopDown ? "resume-milestone" : "create-study-plan",
        label: t(hasTopDown ? "contextMenu.resumeMilestone" : "contextMenu.createStudyPlan"),
        icon: hasTopDown
          ? <GraduationCap className="h-4 w-4 text-primary" />
          : <Plus className="h-4 w-4 text-primary" />,
        onClick: topDownPrimaryAction,
      },
    ];
    if (hasTopDown && onCreateStudyPlan) {
      items.push({
        id: "create-study-plan",
        label: t("contextMenu.createStudyPlan"),
        icon: <Plus className="h-4 w-4 text-muted-foreground" />,
        onClick: onCreateStudyPlan,
      });
    }
    items.push(
      { id: "sep:1", type: ContextMenuItemType.Separator, label: "" },
      {
        id: "launch-queue",
        label: t("contextMenu.launchQueueSession"),
        icon: <Lightning className="h-4 w-4 text-muted-foreground" />,
        onClick: onLaunchQueue,
      },
    );
    return items;
  };

  const buildBottomUpItems = (): ContextMenuItem[] => [
    {
      id: "launch-queue",
      label: t("contextMenu.launchQueueSession"),
      icon: <Lightning className="h-4 w-4 text-amber-500" />,
      onClick: onLaunchQueue,
    },
    { id: "sep:1", type: ContextMenuItemType.Separator, label: "" },
    {
      id: hasTopDown ? "resume-milestone" : "create-study-plan",
      label: t(hasTopDown ? "contextMenu.resumeMilestone" : "contextMenu.createStudyPlan"),
      icon: <GraduationCap className="h-4 w-4 text-muted-foreground" />,
      onClick: topDownPrimaryAction,
    },
  ];

  const buildBannerItems = (): ContextMenuItem[] => [
    {
      id: hasTopDown ? "resume-milestone" : "create-study-plan",
      label: t(hasTopDown ? "contextMenu.resumeMilestone" : "contextMenu.createStudyPlan"),
      icon: <GraduationCap className="h-4 w-4 text-primary" />,
      onClick: topDownPrimaryAction,
    },
    {
      id: "launch-queue",
      label: t("contextMenu.launchQueueSession"),
      icon: <Lightning className="h-4 w-4 text-amber-500" />,
      onClick: onLaunchQueue,
    },
  ];

  return (
    <section
      aria-label="Today's Horizon"
      data-todays-horizon="true"
      onContextMenu={(e) => horizonMenu.openEvent(e, buildBannerItems())}
      className="mb-6 rounded-2xl border border-border bg-card/80 p-4 md:p-5 shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkle className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Today&apos;s Horizon
          </h2>
        </div>
        <span className="text-xs text-muted-foreground">
          Structured curriculum + organic discovery
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Lane 1: Top-Down Milestones */}
        <div
          data-horizon-lane="top-down"
          onContextMenu={(e) => horizonMenu.openEvent(e, buildTopDownItems())}
          className="flex flex-col justify-between rounded-xl border border-border/80 bg-background/60 p-4"
        >
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                <GraduationCap className="h-4 w-4" />
                Top-Down Milestones
              </span>
              {hasTopDown && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  {activePlansCount} Plan{activePlansCount === 1 ? "" : "s"} • {pendingAssessmentsCount} Assessment{pendingAssessmentsCount === 1 ? "" : "s"}
                </span>
              )}
            </div>

            {hasTopDown ? (
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {nextMilestoneTitle || "Continue your active study path"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {upcomingNodesCount} upcoming topic{upcomingNodesCount === 1 ? "" : "s"} •{" "}
                  {pendingAssessmentsCount} pending assessment{pendingAssessmentsCount === 1 ? "" : "s"}
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No active study milestones yet. Create a Study Plan to sequence readings and assessments.
              </p>
            )}
          </div>

          <div className="mt-4">
            {hasTopDown ? (
              <button
                type="button"
                onClick={onResumeMilestone}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <span>Resume Milestone</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onCreateStudyPlan ?? onResumeMilestone}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                <span>Create Study Plan</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Lane 2: Bottom-Up Organic Discovery */}
        <div
          data-horizon-lane="bottom-up"
          onContextMenu={(e) => horizonMenu.openEvent(e, buildBottomUpItems())}
          className="flex flex-col justify-between rounded-xl border border-border/80 bg-background/60 p-4"
        >
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-500">
                <Compass className="h-4 w-4" />
                Bottom-Up Organic Discovery
              </span>
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-500">
                FSRS + Incremental
              </span>
            </div>

            {hasBottomUp ? (
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {dueReviewsCount} Due Reviews • {highPriorityExtractsCount} Priority Extracts
                </p>
                <p className="text-xs text-muted-foreground">
                  {unreadDiscoveryCount > 0
                    ? `${unreadDiscoveryCount} unread discovery items waiting in queue`
                    : "Adaptive mix of due flashcards and top-priority reading extracts"}
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Queue is clear. Import an article or browse your library to seed new incremental extracts.
              </p>
            )}
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={onLaunchQueue}
              className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/90"
            >
              <Lightning className="h-3.5 w-3.5" />
              <span>{hasBottomUp ? "Launch Queue Session" : "Browse Queue"}</span>
            </button>
          </div>
        </div>
      </div>
      <ContextMenu
        menuId="todays-horizon-menu"
        items={horizonMenu.items}
        visible={horizonMenu.visible}
        position={horizonMenu.position}
        onClose={horizonMenu.closeToTrigger}
      />
    </section>
  );
}
