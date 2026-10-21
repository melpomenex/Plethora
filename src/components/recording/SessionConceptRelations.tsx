import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  TreeStructure,
  Link,
  Check,
  Info,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  querySessionConceptRelations,
  linkSessionDocumentToConcept,
  type SessionConceptRelationMatch,
  type ConceptRelationsAdapterResult,
} from "../../services/recording/conceptRelationsAdapter";
import { normalizeConceptName } from "../../api/concept-links";
import { cn } from "../../utils/cn";

export interface SessionConceptRelationsProps {
  sessionDocumentId: string;
  concepts: Array<{ name: string; definition?: string }>;
  className?: string;
}

export const SessionConceptRelations: React.FC<SessionConceptRelationsProps> = ({
  sessionDocumentId,
  concepts,
  className,
}) => {
  const [adapterResult, setAdapterResult] = useState<ConceptRelationsAdapterResult>({
    available: false,
    matches: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [linkingConceptId, setLinkingConceptId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const conceptNames = useMemo(() => concepts.map((c) => c.name), [concepts]);
  const conceptNamesKey = conceptNames.join("\u0000");

  const loadRelations = useCallback(async () => {
    if (!sessionDocumentId || conceptNames.length === 0) {
      setAdapterResult({ available: true, matches: [] });
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const res = await querySessionConceptRelations(sessionDocumentId, conceptNames);
    setAdapterResult(res);
    setIsLoading(false);
  }, [sessionDocumentId, conceptNamesKey]);

  useEffect(() => {
    let active = true;
    if (!sessionDocumentId || conceptNames.length === 0) {
      setAdapterResult({ available: true, matches: [] });
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    querySessionConceptRelations(sessionDocumentId, conceptNames).then((res) => {
      if (active) {
        setAdapterResult(res);
        setIsLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [sessionDocumentId, conceptNamesKey]);

  const handleLink = async (conceptId: string) => {
    setLinkingConceptId(conceptId);
    setActionError(null);
    try {
      await linkSessionDocumentToConcept(sessionDocumentId, conceptId);
      await loadRelations();
    } catch (err) {
      console.error("[SessionConceptRelations] Failed to link concept:", err);
      setActionError("Failed to link concept to this recording.");
    } finally {
      setLinkingConceptId(null);
    }
  };

  if (!concepts || concepts.length === 0) {
    return null;
  }

  // Map matches by normalized name for quick lookup
  const matchMap = new Map<string, SessionConceptRelationMatch>();
  for (const m of adapterResult.matches) {
    matchMap.set(m.normalizedName, m);
  }

  return (
    <div
      data-testid="session-concept-relations"
      className={cn(
        "p-4 bg-card border border-border rounded-xl shadow-sm space-y-3",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <TreeStructure className="w-4 h-4 text-primary" />
          <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Key Concepts
          </h4>
        </div>

        {!isLoading && !adapterResult.available && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground flex items-center gap-1">
            <Info className="w-3 h-3 text-muted-foreground" />
            Cross-session relations unavailable
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {isLoading
          ? "Checking this session's concepts against your course…"
          : adapterResult.available
            ? "Concepts extracted from this session. Link with existing course concepts to preserve shared evidence across multiple recordings without generating duplicate cards."
            : "Course concept matching is unavailable. These concepts remain part of the session; no automatic links or cards were created."}
      </p>

      {actionError && (
        <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-center gap-2">
          <WarningCircle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        {concepts.map((concept, idx) => {
          const norm = normalizeConceptName(concept.name);
          const match = matchMap.get(norm);
          const showRelation = !isLoading && adapterResult.available && Boolean(match?.existingConcept);

          return (
            <div
              key={idx}
              data-testid={`concept-item-${idx}`}
              className="p-3 rounded-lg bg-muted/20 border border-border/50 flex flex-col justify-between gap-2"
            >
              <div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-semibold text-foreground">{concept.name}</span>

                  {!isLoading &&
                    adapterResult.available &&
                    (match?.existingConcept ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                        Known in course
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        New to course
                      </span>
                    ))}
                </div>

                {concept.definition && (
                  <p className="text-muted-foreground mt-1 text-[11px] leading-snug">
                    {concept.definition}
                  </p>
                )}
              </div>

              {/* Cross-session relations and explicit linking */}
              {showRelation && match?.existingConcept && (
                <div className="pt-2 border-t border-border/40 space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between gap-2 flex-wrap text-muted-foreground">
                    <span>
                      {match.otherLinkedSources.length > 0
                        ? `Linked in ${match.otherLinkedSources.length} other source(s)`
                        : "No other sources linked"}
                    </span>

                    {/* Coverage badge distinguishing known evidence from mastery */}
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded font-mono",
                        match.evidenceCoverage === "supported"
                          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                          : match.evidenceCoverage === "partial"
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : "bg-muted text-muted-foreground"
                      )}
                      title="Verified library source coverage (distinct from learner review mastery)"
                    >
                      Evidence: {match.evidenceCoverage}
                    </span>
                  </div>

                  <div className="flex items-center justify-end pt-1">
                    {match.isAlreadyLinkedToSession ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                        <Check className="w-3.5 h-3.5" />
                        Linked to this recording
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={linkingConceptId === match.existingConcept.id}
                        onClick={() => handleLink(match.existingConcept!.id)}
                        aria-label={`Link ${concept.name} to this recording`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary text-primary-foreground text-[10px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        <Link className="w-3 h-3" />
                        {linkingConceptId === match.existingConcept.id ? "Linking..." : "Link Recording"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
