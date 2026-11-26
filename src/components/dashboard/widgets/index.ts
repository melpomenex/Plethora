import type { ElementType } from "react";
import {
  Bookmarks,
  Fire,
  NotePencil,
  PushPin,
  Stack,
  Timer,
} from "@phosphor-icons/react";
import type { DashboardWidgetId } from "../../../stores/dashboardLayoutStore";

export interface DashboardWidgetMeta {
  id: DashboardWidgetId;
  title: string;
  description: string;
  category: string;
  icon: ElementType;
  iconBg: string;
}

export const DASHBOARD_WIDGET_CATALOG: DashboardWidgetMeta[] = [
  {
    id: "widget-focus-timer",
    title: "Focus Timer",
    description: "Pomodoro & deep-work countdown timer with break phases right on your dashboard.",
    category: "Productivity",
    icon: Timer,
    iconBg: "bg-primary/10 text-primary",
  },
  {
    id: "widget-streak-goals",
    title: "Streak & Daily Goal",
    description: "Track your study streak, daily review goal progress, retention, and 7-day activity.",
    category: "Progress",
    icon: Fire,
    iconBg: "bg-amber-500/10 text-amber-500",
  },
  {
    id: "widget-scratchpad",
    title: "Quick Scratchpad",
    description: "Auto-saved local notes for study intentions, questions, and quick capture.",
    category: "Capture",
    icon: NotePencil,
    iconBg: "bg-violet-500/10 text-violet-500",
  },
  {
    id: "widget-up-next",
    title: "Up Next in Queue",
    description: "Preview your next queued reads and jump into any item or Scroll Mode in one click.",
    category: "Reading",
    icon: Stack,
    iconBg: "bg-blue-500/10 text-blue-500",
  },
  {
    id: "widget-saved-queues",
    title: "Saved Queues & Decks",
    description: "Switch active study decks or launch any saved queue directly from the dashboard.",
    category: "Organization",
    icon: Bookmarks,
    iconBg: "bg-cyan-500/10 text-cyan-500",
  },
  {
    id: "widget-pinned-docs",
    title: "Pinned Documents",
    description: "Pin your core reference documents for instant one-click access.",
    category: "Reading",
    icon: PushPin,
    iconBg: "bg-emerald-500/10 text-emerald-500",
  },
];

export { FocusTimerWidget } from "./FocusTimerWidget";
export { StreakGoalsWidget } from "./StreakGoalsWidget";
export { ScratchpadWidget } from "./ScratchpadWidget";
export { UpNextQueueWidget } from "./UpNextQueueWidget";
export { SavedQueuesWidget } from "./SavedQueuesWidget";
export { PinnedDocsWidget } from "./PinnedDocsWidget";
