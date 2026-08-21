/**
 * HelpDocViewer
 * Modal / Slide-over viewer rendering canonical product documentation articles with full markdown and interactive actions.
 */

import React, { useState } from "react";
import type { ProductDocArticle } from "./helpTypes";
import { defaultHelpRetrieval } from "./helpRetrieval";
import { dispatchRegisteredHelpAction } from "./registeredHelpActions";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle,
  Gear,
  Lightning,
  Tag,
  X,
} from "@phosphor-icons/react";
import { renderMarkdown } from "../../utils/markdown";

export interface HelpDocViewerProps {
  initialDocId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const HelpDocViewer: React.FC<HelpDocViewerProps> = ({
  initialDocId,
  isOpen,
  onClose,
}) => {
  const [activeDocId, setActiveDocId] = useState<string>(initialDocId);

  // Sync state if initialDocId changes
  React.useEffect(() => {
    setActiveDocId(initialDocId);
  }, [initialDocId]);

  if (!isOpen || !activeDocId) return null;

  const doc: ProductDocArticle | undefined = defaultHelpRetrieval.getDocument(activeDocId);

  const handleActionClick = (actionId: string) => {
    dispatchRegisteredHelpAction(actionId);
    onClose();
  };

  const handleRelatedClick = (relatedId: string) => {
    setActiveDocId(relatedId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-glass-fade-in">
      <div
        className="relative w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl bg-card border border-border shadow-2xl overflow-hidden animate-glass-scale-in"
        role="dialog"
        aria-modal="true"
        aria-label={doc ? doc.title : "Product Help"}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary-500/10 text-primary-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-300">
                  {doc?.domain || "Help"}
                </span>
                <span className="text-xs text-muted-foreground font-mono">{doc?.id}</span>
              </div>
              <h2 className="text-lg font-semibold text-foreground tracking-tight mt-0.5">
                {doc?.title || "Documentation Article"}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close documentation viewer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {doc ? (
            <>
              {/* Summary & Core Rationale Banner */}
              <div className="p-4 rounded-xl bg-muted/40 border border-border/60 space-y-2">
                <p className="text-sm text-foreground/90 font-medium leading-relaxed">{doc.summary}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 text-xs">
                  <div>
                    <span className="font-semibold text-primary-400 block mb-0.5">How to use:</span>
                    <p className="text-muted-foreground leading-normal">{doc.how_to}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-amber-400 block mb-0.5">Why:</span>
                    <p className="text-muted-foreground leading-normal">{doc.why}</p>
                  </div>
                </div>
              </div>

              {/* Sections (Behavioral Rules, Rationale, etc.) */}
              {Object.entries(doc.sections || {}).map(([secTitle, secContent]) => {
                if (secTitle === "intro") return null;
                return (
                  <div key={secTitle} className="space-y-2">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 border-b border-border/40 pb-1">
                      <CheckCircle className="w-4 h-4 text-primary-400" />
                      <span>{secTitle}</span>
                    </h3>
                    <div
                      className="prose prose-sm dark:prose-invert max-w-none text-xs text-muted-foreground leading-relaxed pl-6 font-sans [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5 [&_pre]:my-2 [&_code]:text-[11px]"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(secContent) }}
                    />
                  </div>
                );
              })}

              {/* Settings Table if present */}
              {doc.settings && doc.settings.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 border-b border-border/40 pb-1">
                    <Gear className="w-4 h-4 text-primary-400" />
                    <span>Configurable Settings</span>
                  </h3>
                  <div className="flex flex-wrap gap-2 pl-6">
                    {doc.settings.map((setting) => (
                      <span
                        key={setting}
                        className="px-2.5 py-1 text-xs font-mono rounded-md bg-muted/60 text-muted-foreground border border-border/50"
                      >
                        {setting}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Interactive Actions */}
              {doc.actions && doc.actions.length > 0 && (
                <div className="p-4 rounded-xl bg-primary-500/5 border border-primary-500/20 space-y-2">
                  <h3 className="text-xs font-semibold text-primary-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Lightning className="w-4 h-4" />
                    <span>Quick Actions in Plethora</span>
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {doc.actions.map((act) => (
                      <button
                        key={act.id}
                        type="button"
                        onClick={() => handleActionClick(act.id)}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-600 hover:bg-primary-500 text-white transition-colors shadow-sm"
                      >
                        <span>{act.label}</span>
                        {act.shortcut && (
                          <kbd className="px-1.5 py-0.5 text-[10px] bg-primary-700/60 rounded">
                            {act.shortcut}
                          </kbd>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Related Documents */}
              {doc.related && doc.related.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-border/40">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                    Related Topics:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {doc.related.map((relId) => {
                      const relDoc = defaultHelpRetrieval.getDocument(relId);
                      return (
                        <button
                          key={relId}
                          type="button"
                          onClick={() => handleRelatedClick(relId)}
                          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-muted/50 hover:bg-muted text-foreground border border-border/50 transition-colors"
                        >
                          <Tag className="w-3 h-3 text-muted-foreground" />
                          <span>{relDoc ? relDoc.title : relId}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-sm">Documentation article not found: {activeDocId}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-border/60 bg-muted/20 text-xs text-muted-foreground">
          <span>Corpus Hash: {defaultHelpRetrieval.getCorpusHash().slice(0, 16)}...</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-md bg-muted hover:bg-muted/80 text-foreground transition-colors"
          >
            Close (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
