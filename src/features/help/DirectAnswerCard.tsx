/**
 * DirectAnswerCard
 * Renders high-confidence zero-latency direct canonical answers in the search palette or help modal.
 */

import React from "react";
import type { DirectLookupResult } from "./helpTypes";
import { ArrowRight, BookOpen, Lightbulb, PlayCircle } from "@phosphor-icons/react";
import { dispatchRegisteredHelpAction } from "./registeredHelpActions";

export interface DirectAnswerCardProps {
  result: DirectLookupResult;
  onOpenFullDoc?: (featureId: string) => void;
  onClosePalette?: () => void;
}

export const DirectAnswerCard: React.FC<DirectAnswerCardProps> = ({
  result,
  onOpenFullDoc,
  onClosePalette,
}) => {
  const handleActionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (result.primaryAction) {
      dispatchRegisteredHelpAction(result.primaryAction.id);
      onClosePalette?.();
    }
  };

  const handleDocClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenFullDoc?.(result.featureId);
  };

  return (
    <div className="p-4 my-2 rounded-xl bg-primary-500/10 border border-primary-500/30 text-foreground transition-all">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-amber-400 shrink-0" weight="fill" />
          <h4 className="text-sm font-semibold text-foreground tracking-tight">{result.title}</h4>
        </div>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-300 border border-primary-500/30 uppercase tracking-wider">
          Direct Guide
        </span>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed mb-3">{result.summary}</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
        <div className="p-2.5 rounded-lg bg-background/50 border border-border/50">
          <span className="text-[11px] font-semibold text-primary-400 block mb-1">How to use:</span>
          <p className="text-xs text-foreground/90 leading-normal">{result.how_to}</p>
        </div>

        <div className="p-2.5 rounded-lg bg-background/50 border border-border/50">
          <span className="text-[11px] font-semibold text-amber-400 block mb-1">Why:</span>
          <p className="text-xs text-foreground/90 leading-normal">{result.why}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40">
        {result.primaryAction ? (
          <button
            type="button"
            onClick={handleActionClick}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-600 hover:bg-primary-500 text-white transition-colors shadow-sm"
          >
            <PlayCircle className="w-4 h-4" />
            <span>{result.primaryAction.label}</span>
            {result.primaryAction.shortcut && (
              <kbd className="ml-1 px-1.5 py-0.5 text-[10px] bg-primary-700/60 rounded text-white/90">
                {result.primaryAction.shortcut}
              </kbd>
            )}
          </button>
        ) : <div />}

        <button
          type="button"
          onClick={handleDocClick}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary-400 transition-colors"
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Read full document</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
