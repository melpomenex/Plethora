/**
 * Reusable, accessible 5-dimension Competency Evidence Inspector for
 * Knowledge Atlas and Study Plans.
 *
 * Displays all 5 competency dimensions (`exposure`, `comprehension`,
 * `retention`, `application`, `transfer`) with strict epistemic honesty:
 * - `unknown` and `insufficient_evidence` are never presented as demonstrated mastery.
 * - `uncertaintyReasons` are shown explicitly whenever present.
 * - Learner self-declarations are rendered in a clearly separate section and
 *   never merged into verified evidence estimates.
 * - Local-only and AI-excluded evidence badges are surfaced transparently.
 */

import {
  ALL_COMPETENCY_DIMENSIONS,
  type CompetencyDimension,
  type CompetencyStatus,
  type ConceptCompetencyProfile,
  type DeclaredCompetencyLevel,
  type DimensionProjection,
} from "../../types/learnerModel";
import { cn } from "../../utils/cn";

export interface CompetencyEvidenceInspectorProps {
  profile: ConceptCompetencyProfile;
  className?: string;
  onRequestPractice?: (
    conceptId: string,
    dimension: CompetencyDimension
  ) => void;
}

const DIMENSION_LABELS: Record<CompetencyDimension, string> = {
  exposure: "Exposure",
  comprehension: "Comprehension",
  retention: "Retention",
  application: "Application",
  transfer: "Transfer",
};

const DIMENSION_DESCRIPTIONS: Record<CompetencyDimension, string> = {
  exposure: "Encountered in reading, extracts, or media",
  comprehension: "Explained or verified through guided checks",
  retention: "Recalled over spaced intervals",
  application: "Applied in structured practice or problem solving",
  transfer: "Generalized to novel contexts or synthesis",
};

const STATUS_META: Record<
  CompetencyStatus,
  { label: string; badgeClass: string; barClass: string }
> = {
  unknown: {
    label: "Unknown",
    badgeClass: "bg-muted text-muted-foreground border-border",
    barClass: "bg-muted-foreground/30",
  },
  insufficient_evidence: {
    label: "Insufficient evidence",
    badgeClass:
      "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    barClass: "bg-amber-500/50",
  },
  needs_attention: {
    label: "Needs attention",
    badgeClass:
      "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
    barClass: "bg-rose-500",
  },
  developing: {
    label: "Developing",
    badgeClass:
      "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
    barClass: "bg-sky-500",
  },
  demonstrated: {
    label: "Demonstrated",
    badgeClass:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    barClass: "bg-emerald-500",
  },
};

const DECLARED_LEVEL_LABELS: Record<DeclaredCompetencyLevel, string> = {
  unfamiliar: "Unfamiliar",
  familiar: "Familiar",
  confident: "Confident",
  needs_refresh: "Needs refresh",
};

function formatRecency(isoTimestamp: string | null): string {
  if (!isoTimestamp) return "No evidence recorded";
  const parsed = Date.parse(isoTimestamp);
  if (Number.isNaN(parsed)) return isoTimestamp;
  return new Date(parsed).toISOString().slice(0, 10);
}

function isUncertainStatus(status: CompetencyStatus): boolean {
  return status === "unknown" || status === "insufficient_evidence";
}

function DimensionRow({
  conceptId,
  projection,
  onRequestPractice,
}: {
  conceptId: string;
  projection: DimensionProjection;
  onRequestPractice?: (
    conceptId: string,
    dimension: CompetencyDimension
  ) => void;
}) {
  const statusMeta = STATUS_META[projection.status];
  const uncertain = isUncertainStatus(projection.status);
  const estimatePercent =
    !uncertain && projection.estimate !== null
      ? Math.round(Math.max(0, Math.min(1, projection.estimate)) * 100)
      : null;

  return (
    <li
      data-testid={`competency-dimension-${projection.dimension}`}
      className="rounded-lg border border-border/70 bg-background/80 p-3 space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">
              {DIMENSION_LABELS[projection.dimension]}
            </span>
            <span
              data-testid={`competency-status-${projection.dimension}`}
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                statusMeta.badgeClass
              )}
            >
              {statusMeta.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {DIMENSION_DESCRIPTIONS[projection.dimension]}
          </p>
        </div>

        <div className="text-right shrink-0">
          {estimatePercent !== null ? (
            <span
              data-testid={`competency-score-${projection.dimension}`}
              className="text-sm font-semibold tabular-nums text-foreground"
            >
              {estimatePercent}%
            </span>
          ) : (
            <span
              data-testid={`competency-score-${projection.dimension}`}
              className="text-xs italic text-muted-foreground"
            >
              Not established
            </span>
          )}
        </div>
      </div>

      {estimatePercent !== null && (
        <div
          className="h-1.5 w-full rounded-full bg-muted overflow-hidden"
          role="progressbar"
          aria-label={`${DIMENSION_LABELS[projection.dimension]} competency`}
          aria-valuenow={estimatePercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={cn("h-full rounded-full transition-all", statusMeta.barClass)}
            style={{ width: `${estimatePercent}%` }}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span data-testid={`competency-provenance-${projection.dimension}`}>
          {projection.rawEvidenceCount}{" "}
          {projection.rawEvidenceCount === 1 ? "evidence record" : "evidence records"}
          {" · "}
          {projection.independentGroups}{" "}
          {projection.independentGroups === 1 ? "group" : "groups"}
          {" · "}
          {projection.distinctDays}{" "}
          {projection.distinctDays === 1 ? "day" : "days"}
        </span>
        <span data-testid={`competency-recency-${projection.dimension}`}>
          Last: {formatRecency(projection.lastEvidenceAt)}
        </span>
      </div>

      {projection.uncertaintyReasons.length > 0 && (
        <ul
          data-testid={`competency-uncertainty-${projection.dimension}`}
          aria-label={`${DIMENSION_LABELS[projection.dimension]} uncertainty reasons`}
          className="rounded-md bg-muted/50 px-2.5 py-1.5 text-[11px] text-muted-foreground space-y-0.5 list-disc list-inside"
        >
          {projection.uncertaintyReasons.map((reason, idx) => (
            <li key={`${projection.dimension}-reason-${idx}`}>{reason}</li>
          ))}
        </ul>
      )}

      {onRequestPractice && (
        <div className="pt-0.5">
          <button
            type="button"
            onClick={() => onRequestPractice(conceptId, projection.dimension)}
            className="text-xs font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
          >
            Gather {DIMENSION_LABELS[projection.dimension].toLowerCase()} evidence
          </button>
        </div>
      )}
    </li>
  );
}

export function CompetencyEvidenceInspector({
  profile,
  className,
  onRequestPractice,
}: CompetencyEvidenceInspectorProps) {
  return (
    <section
      aria-label={`Competency evidence for ${profile.conceptName}`}
      data-testid="competency-evidence-inspector"
      className={cn(
        "rounded-xl border border-border bg-card p-4 space-y-4",
        className
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground truncate">
            {profile.conceptName}
          </h3>
          <p className="text-xs text-muted-foreground">
            5-Dimension Competency Evidence
          </p>
        </div>

        {(profile.containsLocalOnlyEvidence ||
          profile.containsAiExcludedEvidence) && (
          <div
            className="flex flex-wrap items-center gap-1.5 shrink-0"
            aria-label="Privacy boundaries"
          >
            {profile.containsLocalOnlyEvidence && (
              <span
                data-testid="badge-local-only"
                className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground"
              >
                Local-only
              </span>
            )}
            {profile.containsAiExcludedEvidence && (
              <span
                data-testid="badge-ai-excluded"
                className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground"
              >
                AI-excluded
              </span>
            )}
          </div>
        )}
      </header>

      {/* Self-declared level: strictly separate from verified evidence */}
      <div
        data-testid="competency-self-declaration"
        className="rounded-lg border border-dashed border-border bg-muted/30 p-3 space-y-1"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Self-declared level
          </span>
          <span className="text-[11px] text-muted-foreground">
            Separate from verified evidence
          </span>
        </div>
        {profile.selfDeclaration ? (
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {DECLARED_LEVEL_LABELS[profile.selfDeclaration.declaredLevel]}
            </p>
            {profile.selfDeclaration.note && (
              <p className="text-xs text-muted-foreground">
                {profile.selfDeclaration.note}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No self-declaration recorded.
          </p>
        )}
      </div>

      {/* 5 Competency Dimensions */}
      <ul
        aria-label="Competency dimensions"
        className="space-y-2.5"
      >
        {ALL_COMPETENCY_DIMENSIONS.map((dimension) => (
          <DimensionRow
            key={dimension}
            conceptId={profile.conceptId}
            projection={profile.dimensions[dimension]}
            onRequestPractice={onRequestPractice}
          />
        ))}
      </ul>
    </section>
  );
}
