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
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-64 p-2.5 rounded-lg bg-card border border-border shadow-xl text-left z-50 animate-glass-fade-in pointer-events-none">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-primary-400 uppercase tracking-wider mb-1">
            <span>Doc Citation [{citation.index}]</span>
            <span className="text-muted-foreground">• {citation.section}</span>
          </div>
          <div className="text-xs font-medium text-foreground mb-1">{citation.title}</div>
          <p className="text-[11px] text-muted-foreground line-clamp-3 leading-tight">{citation.snippet}</p>
        </div>
      )}
    </span>
  );
};
