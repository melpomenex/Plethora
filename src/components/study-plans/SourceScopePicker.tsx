/**
 * Source Scope Picker component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §2.1
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.2
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T08)
 */

import React, { useState, useEffect } from 'react';
import { MagnifyingGlass, FileText, CheckSquare, Square, Warning, ArrowClockwise } from '@phosphor-icons/react';
import { getDocuments } from '../../api/documents';
import type { Document } from '../../types/document';
import type { SelectedSourceScope } from '../../types/studySource';
import { StudyPlanStateNotice } from './StudyPlanStateNotice';
import { Button } from '../md3/Button';

export interface SourceScopePickerProps {
  selectedScope: SelectedSourceScope;
  onChange: (scope: SelectedSourceScope) => void;
  maxDocuments?: number;
}

export const SourceScopePicker: React.FC<SourceScopePickerProps> = ({
  selectedScope,
  onChange,
  maxDocuments = 24,
}) => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const loadDocs = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const docs = await getDocuments();
      setDocuments(docs || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load library documents');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDocs();
  }, []);

  const handleToggleDoc = (docId: string) => {
    const isSelected = selectedScope.documentIds.includes(docId);
    if (isSelected) {
      onChange({
        ...selectedScope,
        documentIds: selectedScope.documentIds.filter((id) => id !== docId),
      });
    } else {
      if (selectedScope.documentIds.length >= maxDocuments) {
        return; // At maximum
      }
      onChange({
        ...selectedScope,
        documentIds: [...selectedScope.documentIds, docId],
      });
    }
  };

  const filteredDocs = documents.filter((doc) =>
    (doc.title || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedCount = selectedScope.documentIds.length;
  const isAtLimit = selectedCount >= maxDocuments;

  return (
    <fieldset className="border border-surface-200 dark:border-surface-700/80 rounded-2xl p-5 bg-surface-50/50 dark:bg-surface-800/30">
      <legend className="px-2 text-sm font-semibold text-surface-900 dark:text-surface-100">
        Source Material Scope (Optional)
      </legend>

      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs text-surface-600 dark:text-surface-400">
          Select material from your library to ground this study plan.
        </p>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            isAtLimit
              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
              : 'text-surface-500'
          }`}
        >
          {selectedCount} / {maxDocuments} documents
        </span>
      </div>

      {isAtLimit && (
        <div
          role="alert"
          className="mb-3 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2"
        >
          <Warning size={16} className="flex-shrink-0" />
          <span>Maximum {maxDocuments} source documents reached. Deselect one to add another.</span>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="py-8 text-center text-xs text-surface-500 animate-pulse">
          Loading library material…
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <div className="py-4 text-center">
          <p className="text-xs text-red-500 mb-2">{error}</p>
          <Button variant="tonal" size="sm" onClick={loadDocs}>
            <ArrowClockwise size={14} />
            <span>Retry</span>
          </Button>
        </div>
      )}

      {/* Empty library state */}
      {!isLoading && !error && documents.length === 0 && (
        <StudyPlanStateNotice
          type="empty_library"
          message="No documents found in your library. You can create a custom study plan now and add source references later."
        />
      )}

      {/* Document selection list */}
      {!isLoading && !error && documents.length > 0 && (
        <div>
          {/* Search bar */}
          <div className="relative mb-3">
            <MagnifyingGlass
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search library documents…"
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              aria-label="Search documents to select"
            />
          </div>

          <div
            role="listbox"
            aria-multiselectable="true"
            aria-label="Source documents list"
            className="max-h-56 overflow-y-auto space-y-1 pr-1 focus:outline-none"
          >
            {filteredDocs.length === 0 ? (
              <div className="py-4 text-center text-xs text-surface-500">
                No matching documents found.
              </div>
            ) : (
              filteredDocs.map((doc) => {
                const isSelected = selectedScope.documentIds.includes(doc.id);
                const disabled = !isSelected && isAtLimit;

                return (
                  <div
                    key={doc.id}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                    onClick={() => !disabled && handleToggleDoc(doc.id)}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        if (!disabled) handleToggleDoc(doc.id);
                      }
                    }}
                    className={`flex items-center justify-between p-2.5 rounded-xl text-xs transition-colors cursor-pointer select-none ${
                      isSelected
                        ? 'bg-primary-500/10 text-primary-900 dark:text-primary-100 border border-primary-500/30'
                        : disabled
                        ? 'opacity-40 cursor-not-allowed bg-transparent'
                        : 'hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-800 dark:text-surface-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <FileText size={16} className="text-surface-400 flex-shrink-0" />
                      <span className="truncate font-medium">{doc.title || 'Untitled Document'}</span>
                    </div>

                    <div className="flex-shrink-0 text-primary-600 dark:text-primary-400">
                      {isSelected ? <CheckSquare size={18} weight="fill" /> : <Square size={18} />}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
};
