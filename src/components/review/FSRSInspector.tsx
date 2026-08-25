/**
 * Algorithm Inspector Panel
 *
 * DevTools-style panel for power users to inspect algorithm parameters.
 * Toggled via Cmd+I (like browser DevTools).
 *
 * Features:
 * - Current card parameters (D, S, R)
 * - Forget curve visualization (FSRS: R=exp(-t/S), Adaptive: R=0.9^(t/S))
 * - Simulated interval calculation
 * - Raw memory state data
 * - Algorithm-aware: adapts labels and formulas for FSRS-6 and Adaptive
 */

import { useState, useRef } from "react";
import {
  Brain,
  Clock,
  Database,
  Pulse,
  TrendDown,
  X,
} from "@phosphor-icons/react";
import { cn } from "../../utils";
import type { LearningItem } from "../../api/review";
import { parseAdaptiveState, adaptiveRetrievability, type AdaptiveState } from "../../lib/adaptiveScheduler";
import { parsePrecisionState, precisionRetrievability, type PrecisionState } from "../../lib/precisionScheduler";
import { useSettingsStore } from "../../stores/settingsStore";
import { schedulerLabel } from "../../lib/schedulerCatalog";
import {
  isAdaptiveScheduler,
  isPrecisionScheduler,
  normalizeSchedulerId,
} from "../../lib/schedulerIdentity";

interface FSRSInspectorProps {
  card: LearningItem | null;
  isOpen: boolean;
  onClose: () => void;
}

// Forget curve calculation — branches on algorithm type
function calculateForgetCurve(
  stability: number,
  days: number[],
  algorithmType?: string,
  _elapsedDays?: number
): { day: number; retrievability: number }[] {
  if (isAdaptiveScheduler(algorithmType) || isPrecisionScheduler(algorithmType)) {
    return days.map((day) => ({
      day,
      retrievability: Math.pow(0.9, day / stability),
    }));
  }
  // FSRS-6 default
  return days.map((day) => ({
    day,
    retrievability: Math.exp(-day / stability),
  }));
}

// Simple SVG line chart for forget curve
function ForgetCurveChart({
  data,
  width = 280,
  height = 100
}: {
  data: { day: number; retrievability: number }[];
  width?: number;
  height?: number;
}) {
  if (data.length === 0) return null;

  const padding = { top: 5, right: 5, bottom: 20, left: 30 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const maxDay = data[data.length - 1].day;

  const xScale = (day: number) => padding.left + (day / maxDay) * chartWidth;
  const yScale = (r: number) => padding.top + (1 - r) * chartHeight;

  // Generate path
  const pathD = data
    .map((point, i) => {
      const x = xScale(point.day);
      const y = yScale(point.retrievability);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  // Area fill path
  const areaD = `${pathD} L ${xScale(maxDay)} ${padding.top + chartHeight} L ${padding.left} ${padding.top + chartHeight} Z`;

  return (
    <svg width={width} height={height} className="text-muted-foreground">
      {/* Grid lines */}
      {[0.25, 0.5, 0.75, 1].map((tick) => (
        <g key={tick}>
          <line
            x1={padding.left}
            y1={yScale(tick)}
            x2={width - padding.right}
            y2={yScale(tick)}
            stroke="currentColor"
            strokeOpacity={0.1}
            strokeDasharray="2,2"
          />
          <text
            x={padding.left - 5}
            y={yScale(tick) + 3}
            fontSize="8"
            textAnchor="end"
            fill="currentColor"
            fillOpacity={0.5}
          >
            {(tick * 100).toFixed(0)}%
          </text>
        </g>
      ))}

      {/* Area fill */}
      <path d={areaD} fill="currentColor" fillOpacity={0.05} />

      {/* Line */}
      <path
        d={pathD}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeOpacity={0.6}
      />

      {/* X-axis labels */}
      {[0, Math.floor(maxDay / 2), maxDay].map((day) => (
        <text
          key={day}
          x={xScale(day)}
          y={height - 5}
          fontSize="8"
          textAnchor="middle"
          fill="currentColor"
          fillOpacity={0.5}
        >
          {day}d
        </text>
      ))}
    </svg>
  );
}

function ParameterRow({
  label,
  value,
  unit = "",
  description,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  unit?: string;
  description: string;
  icon: React.ElementType;
}) {
  return (
    <div className="group relative">
      <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-muted-foreground/60" />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <div className="text-xs font-mono text-foreground">
          {value}{unit}
        </div>
      </div>
      <div className="absolute right-0 top-full mt-1 px-2 py-1 bg-popover border border-border rounded text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-nowrap">
        {description}
      </div>
    </div>
  );
}

export function FSRSInspector({ card, isOpen, onClose }: FSRSInspectorProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [showRaw, setShowRaw] = useState(false);
  const { settings } = useSettingsStore();

  if (!isOpen || !card) return null;

  // Use card's algorithm_type if set, otherwise fall back to user's setting
  const effectiveAlgorithm = normalizeSchedulerId(
    card.algorithm_type || settings.learning.algorithm,
  );
  const isAdaptive = effectiveAlgorithm === "adaptive";
  const isPrecision = effectiveAlgorithm === "precision";
  const adaptiveState: AdaptiveState | null = isAdaptive ? parseAdaptiveState(card.algorithm_state) : null;
  const precisionState: PrecisionState | null = isPrecision ? parsePrecisionState(card.algorithm_state) : null;

  const stability = isAdaptive && adaptiveState
    ? adaptiveState.stability
    : isPrecision && precisionState
    ? precisionState.stability
    : card.memory_state?.stability ?? 0;
  const difficulty = isAdaptive && adaptiveState
    ? adaptiveState.difficulty
    : isPrecision && precisionState
    ? precisionState.difficulty
    : card.memory_state?.difficulty ?? 0;
  const retrievability = isAdaptive && adaptiveState && adaptiveState.stability > 0
    ? adaptiveRetrievability(adaptiveState.stability, adaptiveState.elapsed)
    : isPrecision && precisionState && precisionState.stability > 0
    ? precisionRetrievability(
        precisionState.stability,
        card.last_review_date
          ? (Date.now() - new Date(card.last_review_date).getTime()) / (86400 * 1000)
          : 0
      )
    : (card.memory_state as any)?.retrievability ?? 0;

  const inspectorTitle = isAdaptive
    ? `${schedulerLabel("adaptive")} Inspector`
    : isPrecision
      ? `${schedulerLabel("precision")} Inspector`
      : `${schedulerLabel("fsrs")} Inspector`;

  // Calculate forget curve data
  const curveDays = [0, 1, 3, 7, 14, 30, 60, 90];
  const forgetCurve = stability > 0
    ? calculateForgetCurve(stability, curveDays, effectiveAlgorithm, adaptiveState?.elapsed)
    : curveDays.map((day) => ({ day, retrievability: 1 }));

  // Calculate optimal intervals for each rating
  const calculateInterval = (rating: number) => {
    if (!stability) return 0;
    // Simplified interval calculation
    const multipliers = { 1: 0.1, 2: 0.8, 3: 1.0, 4: 1.5 };
    return Math.round(stability * (multipliers[rating as keyof typeof multipliers] || 1));
  };

  // Algorithm-specific descriptions
  const stabilityDesc = isAdaptive
    ? "Days until retrievability drops to 90%"
    : isPrecision
    ? "Days until retrievability drops to 90%"
    : "Days until retrievability drops to ~37%";
  const difficultyDesc = isAdaptive
    ? "0-1 scale. Higher = harder to remember"
    : isPrecision
    ? "0-1 scale. Higher = harder to remember"
    : "1-10 scale. Higher = harder to remember";

  return (
    <>
      {/* Backdrop for tapping away to close */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[1px] z-40 transition-opacity duration-150"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        className={cn(
          "fixed right-0 top-0 bottom-0 w-80 bg-card border-l border-border shadow-2xl z-50 flex flex-col pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]",
          "transform transition-transform duration-150 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Pulse className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">{inspectorTitle}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
        {/* Card ID */}
        <div className="px-4 py-2 bg-muted/50 border-b border-border">
          <div className="text-[10px] font-mono text-muted-foreground truncate">
            ID: {card.id}
          </div>
        </div>

        {/* Parameters */}
        <div className="p-4 space-y-1">
          <div className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2">
            <Brain className="w-3.5 h-3.5" />
            Memory State
          </div>

          <ParameterRow
            label="Stability (S)"
            value={stability ? stability.toFixed(2) : "—"}
            unit="d"
            description={stabilityDesc}
            icon={Clock}
          />

          <ParameterRow
            label="Difficulty (D)"
            value={difficulty != null ? difficulty.toFixed(2) : "—"}
            description={difficultyDesc}
            icon={Pulse}
          />

          <ParameterRow
            label="Retrievability (R)"
            value={retrievability ? (retrievability * 100).toFixed(1) : "—"}
            unit="%"
            description="Current probability of recall"
            icon={Brain}
          />

          {isAdaptive && adaptiveState && (
            <>
              <ParameterRow
                label="Reps"
                value={adaptiveState.repetition}
                description="Repetitions since last lapse"
                icon={Pulse}
              />
              <ParameterRow
                label="Lapses"
                value={adaptiveState.lapses}
                description="Total times forgotten (grade < 3)"
                icon={Pulse}
              />
            </>
          )}
          {isPrecision && precisionState && (
            <>
              <ParameterRow
                label="Reps"
                value={precisionState.repetition}
                description="Successful repetitions completed"
                icon={Pulse}
              />
              <ParameterRow
                label="Lapses"
                value={precisionState.lapses}
                description="Total failed reviews"
                icon={Pulse}
              />
            </>
          )}
        </div>

        {/* Forget Curve */}
        <div className="px-4 py-3 border-t border-border">
          <div className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
            <TrendDown className="w-3.5 h-3.5" />
            Forget Curve
          </div>
          <div className="bg-muted/30 rounded p-2">
            <ForgetCurveChart data={forgetCurve} />
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground">
            Projected retrievability over time based on current stability.
            {isAdaptive || isPrecision ? " R = 0.9^(t/S)" : " R = exp(-t/S)"}
          </div>
        </div>

        {/* Optimal Intervals */}
        <div className="px-4 py-3 border-t border-border">
          <div className="text-xs font-semibold text-foreground mb-2">
            Simulated Intervals
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map((rating) => {
              const labels = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
              const interval = calculateInterval(rating);
              return (
                <div
                  key={rating}
                  className="bg-muted/50 rounded px-2 py-1.5 text-center"
                >
                  <div className="text-[10px] text-muted-foreground">
                    {labels[rating as keyof typeof labels]}
                  </div>
                  <div className="text-xs font-mono text-foreground">
                    {interval > 0 ? `${interval}d` : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Raw Data Toggle */}
        <div className="px-4 py-3 border-t border-border">
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Database className="w-3.5 h-3.5" />
            {showRaw ? "Hide" : "Show"} raw data
          </button>

          {showRaw && (
            <pre className="mt-2 text-[9px] font-mono text-muted-foreground bg-muted/50 rounded p-2 overflow-x-auto">
              {JSON.stringify(
                {
                  ...card,
                  question: undefined,
                  answer: undefined,
                  cloze_text: undefined,
                },
                null,
                2
              )}
            </pre>
          )}
        </div>

        {/* Keyboard hint */}
        <div className="px-4 py-3 border-t border-border">
          <div className="text-[10px] text-muted-foreground/60 text-center">
            Press Cmd+I to toggle
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

// Hook to manage inspector state
export function useFSRSInspector() {
  const [isOpen, setIsOpen] = useState(false);

  return { isOpen, setIsOpen };
}
