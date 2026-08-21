/**
 * HelpCitationPill
 * Interactive citation badge linking generated answers back to canonical documentation articles.
 */

import React, { useState } from "react";
import type { HelpCitationRef } from "./helpTypes";
import { BookOpen } from "@phosphor-icons/react";

export interface HelpCitationPillProps {
  citation: HelpCitationRef;
  onClick?: (docId: string) => void;
}

export const HelpCitationPill: React.FC<HelpCitationPillProps> = ({ citation, onClick }) => {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <span className="relative inline-block align-middle mx-1">
      <button
        type="button"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={() => onClick?.(citation.docId)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-primary-500/15 hover:bg-primary-500/25 text-primary-300 border border-primary-500/30 transition-all cursor-pointer"
        aria-label={`Citation [${citation.index}]: ${citation.title}`}
      >
        <BookOpen className="w-3 h-3 text-primary-400" />
        <span>[{citation.index}]</span>
      </button>

      {showTooltip && (
        <div
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 rounded-xl bg-popover text-popover-foreground border border-border/80 shadow-2xl text-left z-[100] animate-glass-fade-in pointer-events-none ring-1 ring-black/20 dark:ring-white/10 backdrop-blur-2xl"
          style={{
            backgroundColor: "var(--color-popover, #1c1917)",
            color: "var(--color-popover-foreground, #f5f5f4)",
          }}
        >
          <div className="flex items-center justify-between gap-1.5 text-[10px] font-semibold text-primary-400 uppercase tracking-wider mb-1.5 border-b border-border/40 pb-1">
            <span className="flex items-center gap-1 shrink-0">
              <BookOpen className="w-3 h-3 text-primary-400" />
              <span>Doc Citation [{citation.index}]</span>
            </span>
            <span className="text-muted-foreground font-normal truncate max-w-[130px]">{citation.section}</span>
          </div>
          <div className="text-xs font-semibold text-foreground mb-1.5 leading-snug">{citation.title}</div>
          <div className="text-[11px] text-muted-foreground line-clamp-4 leading-relaxed font-sans bg-muted/60 p-2 rounded-lg border border-border/40 text-foreground/90">
            "{citation.snippet}"
          </div>
        </div>
      )}
    </span>
  );
};
