/**
 * Source Scope Picker component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §2.1
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.2
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T08)
 */

import React, { useState, useEffect } from 'react';
import { MagnifyingGlass, FileText, Warning, ArrowClockwise } from '@phosphor-icons/react';
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
    <fieldset className="min-w-0 w-full border border-surface-200 dark:border-surface-700/80 rounded-2xl p-5 bg-surface-50/50 dark:bg-surface-800/30">
      <legend className="max-w-full px-2 text-sm font-semibold text-surface-900 dark:text-surface-100">
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

      {selectedScope.extractIds.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span>{selectedScope.extractIds.length} selected {selectedScope.extractIds.length === 1 ? 'extract' : 'extracts'}</span>
          <button
            type="button"
            className="min-h-10 rounded-md px-2 text-primary focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => onChange({ ...selectedScope, extractIds: [] })}
          >
            Clear extracts
          </button>
        </div>
      )}

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

          <div aria-label="Source documents list" className="max-h-56 overflow-y-auto space-y-1 pr-1">
            {filteredDocs.length === 0 ? (
              <div className="py-4 text-center text-xs text-surface-500">
                No matching documents found.
              </div>
            ) : (
              filteredDocs.map((doc) => {
                const isSelected = selectedScope.documentIds.includes(doc.id);
                const disabled = !isSelected && isAtLimit;

                return (
                  <label
                    key={doc.id}
                    className={`flex items-center justify-between p-2.5 rounded-xl text-xs transition-colors cursor-pointer select-none ${
                      isSelected
                        ? 'bg-primary-500/10 text-primary-900 dark:text-primary-100 border border-primary-500/30'
                        : disabled
                        ? 'opacity-40 cursor-not-allowed bg-transparent'
                        : 'hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-800 dark:text-surface-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={disabled}
                        onChange={() => handleToggleDoc(doc.id)}
                        aria-label={doc.title || 'Untitled Document'}
                        className="rounded text-primary-600 focus:ring-primary-500"
                      />
                      <FileText size={16} aria-hidden="true" className="text-surface-400 flex-shrink-0" />
                      <span className="truncate font-medium">{doc.title || 'Untitled Document'}</span>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
};
