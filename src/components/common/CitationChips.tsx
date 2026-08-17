import React, { useState } from 'react';
import { RagCitation } from '../../types/rag';
import { useTabsStore } from '../../stores/tabsStore';
import { openDocumentAtLocation } from '../../utils/openDocumentAtLocation';
import { BookOpen, FileText, VideoCamera, BookmarkSimple } from '@phosphor-icons/react';

interface CitationChipsProps {
  citations: RagCitation[];
  onSelectCitation?: (citation: RagCitation) => void;
  className?: string;
}

export const CitationChips: React.FC<CitationChipsProps> = ({
  citations,
  onSelectCitation,
  className = '',
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!citations || citations.length === 0) {
    return null;
  }

  const handleClick = (citation: RagCitation) => {
    if (onSelectCitation) {
      onSelectCitation(citation);
      return;
    }

    // Default deep-link navigation via shared openDocumentAtLocation
    const { documentId, locator } = citation;
    if (documentId) {
      const addTab = useTabsStore.getState().addTab;
      openDocumentAtLocation(
        documentId,
        {
          initialJump:
            locator.type === 'pdf' && locator.page
              ? { kind: 'pdf', pageNumber: locator.page }
              : locator.type === 'epub' && locator.cfi
                ? { kind: 'epub', cfi: locator.cfi }
                : locator.type === 'video' && locator.timestampSeconds !== undefined
                  ? { kind: 'youtube', timeSeconds: locator.timestampSeconds }
                  : undefined,
        },
        addTab
      );
    }
  };

  const renderIcon = (type: string) => {
    switch (type) {
      case 'pdf':
        return <FileText className="w-3 h-3 text-red-500" />;
      case 'epub':
        return <BookOpen className="w-3 h-3 text-blue-500" />;
      case 'video':
        return <VideoCamera className="w-3 h-3 text-purple-500" />;
      case 'extract':
        return <BookmarkSimple className="w-3 h-3 text-amber-500" />;
      default:
        return <FileText className="w-3 h-3 text-muted-foreground" />;
    }
  };

  const getLocatorLabel = (citation: RagCitation): string => {
    const { locator } = citation;
    if (locator.page) return `p. ${locator.page}`;
    if (locator.cfi) return 'chapter ref';
    if (locator.timestampSeconds !== undefined) {
      const mins = Math.floor(locator.timestampSeconds / 60);
      const secs = Math.floor(locator.timestampSeconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    if (locator.extractId) return 'extract';
    return 'source';
  };

  return (
    <div className={`flex flex-wrap gap-1.5 items-center my-1 ${className}`}>
      {citations.map((citation, idx) => (
        <div key={`${citation.documentId}-${citation.chunkId}-${idx}`} className="relative inline-block">
          <button
            type="button"
            onClick={() => handleClick(citation)}
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border transition-colors cursor-pointer"
            title={citation.quote}
          >
            {renderIcon(citation.locator.type)}
            <span>[{idx + 1}] {getLocatorLabel(citation)}</span>
          </button>

          {/* Hover preview tooltip */}
          {hoveredIdx === idx && citation.quote && (
            <div className="absolute bottom-full left-0 mb-1 z-50 w-64 p-2 bg-popover text-popover-foreground text-xs rounded-md shadow-lg border border-border pointer-events-none animate-in fade-in-50 duration-150">
              <p className="font-semibold text-primary mb-1">
                Source Citation [{idx + 1}]
              </p>
              <p className="line-clamp-3 text-muted-foreground italic">
                "{citation.quote}"
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
