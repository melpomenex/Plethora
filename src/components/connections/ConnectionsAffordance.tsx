import React, { useState } from 'react';
import { useConnectionsStore } from '../../stores/connectionsStore';
import { CitationChips } from '../common/CitationChips';
import { formatRelationLabel, ConnectionSuggestion } from '../../types/connections';
import { Sparkle, Check, X, CaretRight } from '@phosphor-icons/react';

interface ConnectionsAffordanceProps {
  documentId: string;
}

export const ConnectionsAffordance: React.FC<ConnectionsAffordanceProps> = ({
  documentId,
}) => {
  const suggestions = useConnectionsStore((state) =>
    state.getSuggestionsForDocument(documentId)
  );
  const { acceptConnection, dismissConnection } = useConnectionsStore();
  const [isOpen, setIsOpen] = useState(false);
  const [activeItem, setActiveItem] = useState<ConnectionSuggestion | null>(null);

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="relative inline-block my-2">
      {/* Calm margin badge button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border border-amber-500/20 transition-all shadow-sm cursor-pointer"
        title="Semantic connection discovered"
      >
        <Sparkle className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
        <span>{suggestions.length} Related Connection{suggestions.length === 1 ? '' : 's'}</span>
      </button>

      {/* Popover */}
      {isOpen && (
        <div className="absolute left-0 mt-2 z-40 w-80 p-3 bg-popover text-popover-foreground rounded-xl shadow-xl border border-border space-y-3">
          <div className="flex items-center justify-between border-b pb-2">
            <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Sparkle className="w-3.5 h-3.5 text-amber-500" />
              Connected Knowledge
            </h4>
            <button
              onClick={() => setIsOpen(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto">
            {suggestions.map((item) => (
              <div
                key={item.id}
                className="p-2.5 rounded-lg border bg-muted/40 hover:bg-muted/70 transition-colors space-y-1.5 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-primary">
                    {formatRelationLabel(item.relation)}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => acceptConnection(item.id)}
                      className="p-1 rounded bg-green-500/10 hover:bg-green-500/20 text-green-600"
                      title="Accept & Link in Knowledge Graph"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => dismissConnection(item.id)}
                      className="p-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-600"
                      title="Dismiss suggestion"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <p className="text-muted-foreground line-clamp-2">
                  {item.explanation}
                </p>

                <CitationChips citations={[item.rightCitation]} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
