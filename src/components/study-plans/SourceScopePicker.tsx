/**
 * Source Scope Picker component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §2.1
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.2
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T08)
 */

import React, { useState, useEffect, useMemo } from 'react';
import { MagnifyingGlass, FileText, Warning, ArrowClockwise } from '@phosphor-icons/react';
import { getDocuments } from '../../api/documents';
import { getStudySourceCatalog } from '../../api/study-sources';
import type { SelectedSourceScope, StudySourceCatalogItem } from '../../types/studySource';
import { StudyPlanStateNotice } from './StudyPlanStateNotice';
import { Button } from '../md3/Button';
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";
import { studyErrorMessage } from "../../lib/study-plans/studyErrorMessage";
import { isTauri } from "../../lib/tauri";
import {
  catalogItemFromDocument,
  isItemSelectableForStudyScope,
  matchesCategoryFilter,
  prepareActionLabel,
  prepareStudySource,
  readinessBadgeLabel,
  resolveCatalogItemToDocumentId,
  sourceCategoryLabel,
  type SourceCategoryFilter,
} from "../../lib/study-plans/universalSourceAdapter";

export interface SourceScopePickerProps {
  selectedScope: SelectedSourceScope;
  onChange: (scope: SelectedSourceScope) => void;
  maxDocuments?: number;
}

const FILTER_OPTIONS: Array<{ id: SourceCategoryFilter; labelKey: string }> = [
  { id: 'all', labelKey: 'studyPlans.ui.filter-all' },
  { id: 'ready', labelKey: 'studyPlans.ui.filter-ready' },
  { id: 'documents', labelKey: 'studyPlans.ui.filter-docs' },
  { id: 'media', labelKey: 'studyPlans.ui.filter-media' },
  { id: 'feeds', labelKey: 'studyPlans.ui.filter-feeds' },
  { id: 'needs-prep', labelKey: 'studyPlans.ui.filter-needs-prep' },
];

export const SourceScopePicker: React.FC<SourceScopePickerProps> = ({
  selectedScope,
  onChange,
  maxDocuments = 24,
}) => {
  useI18n();
  const [items, setItems] = useState<StudySourceCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prepMessage, setPrepMessage] = useState<string | null>(null);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<SourceCategoryFilter>('all');

  const loadDocs = async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (isTauri()) {
        let catalogErr: unknown = null;
        try {
          if (typeof getStudySourceCatalog === 'function') {
            const catalog = await getStudySourceCatalog(false);
            if (Array.isArray(catalog) && catalog.length > 0) {
              setItems(catalog);
              return;
            }
          }
        } catch (err) {
          catalogErr = err;
        }
        const docs = await getDocuments();
        if (Array.isArray(docs) && docs.length > 0) {
          setItems(docs.map(catalogItemFromDocument));
          return;
        }
        if (catalogErr) {
          throw catalogErr;
        }
        setItems([]);
        return;
      }
      const docs = await getDocuments();
      setItems((docs || []).map(catalogItemFromDocument));
    } catch (err: any) {
      setError(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.operation-failed")));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDocs();
  }, []);

  const handleToggleItem = async (item: StudySourceCatalogItem) => {
    if (!isItemSelectableForStudyScope(item)) {
      return;
    }

    if (item.documentId) {
      const docId = item.documentId;
      const isSelected = selectedScope.documentIds.includes(docId);
      if (isSelected) {
        onChange({
          ...selectedScope,
          documentIds: selectedScope.documentIds.filter((id) => id !== docId),
        });
      } else if (selectedScope.documentIds.length < maxDocuments) {
        onChange({
          ...selectedScope,
          documentIds: [...selectedScope.documentIds, docId],
        });
      }
      return;
    }

    // Promotable source (e.g. ready RSS article or transcribed podcast episode)
    if (selectedScope.documentIds.length >= maxDocuments) {
      return;
    }
    setPreparingId(item.id);
    setPrepMessage(null);
    try {
      const docId = await resolveCatalogItemToDocumentId(item);
      await loadDocs();
      if (!selectedScope.documentIds.includes(docId)) {
        onChange({
          ...selectedScope,
          documentIds: [...selectedScope.documentIds, docId],
        });
      }
    } catch (err: any) {
      setPrepMessage(studyErrorMessage(err, err?.message || 'Could not add source to library scope.'));
    } finally {
      setPreparingId(null);
    }
  };

  const handlePrepare = async (e: React.MouseEvent, item: StudySourceCatalogItem) => {
    e.preventDefault();
    e.stopPropagation();
    setPreparingId(item.id);
    setPrepMessage(null);
    try {
      const result = await prepareStudySource(item, { consentGranted: true });
      setPrepMessage(result.message);
      await loadDocs();
      if (result.documentId && result.status === 'completed' && selectedScope.documentIds.length < maxDocuments) {
        if (!selectedScope.documentIds.includes(result.documentId)) {
          onChange({
            ...selectedScope,
            documentIds: [...selectedScope.documentIds, result.documentId],
          });
        }
      }
    } catch (err: any) {
      setPrepMessage(err?.message || 'Source preparation failed.');
    } finally {
      setPreparingId(null);
    }
  };

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return items.filter((item) => {
      if (!matchesCategoryFilter(item, categoryFilter)) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        (item.subtitle?.toLowerCase().includes(q) ?? false) ||
        item.sourceCategory.toLowerCase().includes(q)
      );
    });
  }, [items, categoryFilter, searchQuery]);

  const showCategoryChips = useMemo(
    () =>
      items.some(
        (item) =>
          !isItemSelectableForStudyScope(item) ||
          ['youtube', 'video', 'audio', 'podcast', 'rss'].includes(item.sourceCategory)
      ),
    [items]
  );

  const selectedCount = selectedScope.documentIds.length;
  const isAtLimit = selectedCount >= maxDocuments;

  return (
    <fieldset className="min-w-0 w-full border border-surface-200 dark:border-surface-700/80 rounded-2xl p-5 bg-surface-50/50 dark:bg-surface-800/30">
      <legend className="max-w-full px-2 text-sm font-semibold text-surface-900 dark:text-surface-100">
        {translateRecentFeature("studyPlans.ui.source-material-scope-option.d9e5626e")}</legend>

      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs text-surface-600 dark:text-surface-400">
          {translateRecentFeature("studyPlans.ui.select-material-from-your-li.4b689a08")}</p>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            isAtLimit
              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
              : 'text-surface-500'
          }`}
        >{translateRecentFeature("studyPlans.ui.var0-var1-documents.dcc2737f", {var0: selectedCount, var1: maxDocuments})}</span>
      </div>

      {selectedScope.extractIds.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span>{translateRecentFeature("studyPlans.ui.var0-selected.288ff143", {var0: selectedScope.extractIds.length})}{selectedScope.extractIds.length === 1 ? translateRecentFeature("studyPlans.ui.extract.29271d92") : translateRecentFeature("studyPlans.ui.extracts.8c508ae6")}</span>
          <button
            type="button"
            className="min-h-10 rounded-md px-2 text-primary focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => onChange({ ...selectedScope, extractIds: [] })}
          >
            {translateRecentFeature("studyPlans.ui.clear-extracts.4e69fc26")}</button>
        </div>
      )}

      {isAtLimit && (
        <div
          role="alert"
          className="mb-3 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2"
        >
          <Warning size={16} className="flex-shrink-0" />
          <span>{translateRecentFeature("studyPlans.ui.maximum-var0-source-document.a096ddb6", {var0: maxDocuments})}</span>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="py-8 text-center text-xs text-surface-500 animate-pulse">
          {translateRecentFeature("studyPlans.ui.loading-library-material.0fe0b0ea")}</div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <div className="py-4 text-center">
          <p className="text-xs text-red-500 mb-2">{error}</p>
          <Button variant="tonal" size="sm" onClick={loadDocs}>
            <ArrowClockwise size={14} />
            <span>{translateRecentFeature("assistant.actions.retry")}</span>
          </Button>
        </div>
      )}

      {/* Empty library state */}
      {!isLoading && !error && items.length === 0 && (
        <StudyPlanStateNotice
          type="empty_library"
          message={translateRecentFeature("studyPlans.ui.no-documents-found-in-your-l.b0099c7a")}
        />
      )}

      {/* Document selection list */}
      {!isLoading && !error && items.length > 0 && (
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
              placeholder={translateRecentFeature("studyPlans.ui.search-library-documents.3fb17892")}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              aria-label={translateRecentFeature("studyPlans.ui.search-documents-to-select.f924dd8e")}
            />
          </div>

          {showCategoryChips && (
            <div className="flex flex-wrap gap-1.5 mb-2.5" role="group" aria-label={translateRecentFeature("studyPlans.ui.filter-source-types")}>
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setCategoryFilter(opt.id)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
                    categoryFilter === opt.id
                      ? 'bg-primary-500/15 border-primary-500/40 text-primary-700 dark:text-primary-300'
                      : 'border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800'
                  }`}
                >
                  {translateRecentFeature(opt.labelKey)}
                </button>
              ))}
            </div>
          )}

          {prepMessage && (
            <div className="mb-2.5 px-2.5 py-1.5 rounded-lg bg-surface-100 dark:bg-surface-800 text-[11px] text-surface-700 dark:text-surface-200">
              {prepMessage}
            </div>
          )}

          <div aria-label={translateRecentFeature("studyPlans.ui.source-documents-list.f7507224")} className="max-h-56 overflow-y-auto space-y-1 pr-1">
            {filteredItems.length === 0 ? (
              <div className="py-4 text-center text-xs text-surface-500">
                {translateRecentFeature("studyPlans.ui.no-matching-documents-found.560ef294")}</div>
            ) : (
              filteredItems.map((item) => {
                const isSelected = Boolean(item.documentId && selectedScope.documentIds.includes(item.documentId));
                const selectable = isItemSelectableForStudyScope(item);
                const disabled = !selectable || (!isSelected && isAtLimit) || preparingId === item.id;
                const badge = readinessBadgeLabel(item.readiness);
                const actionLabel = prepareActionLabel(item.prepareAction);
                const isConsentPrep =
                  !selectable &&
                  item.readiness !== 'ai-excluded' &&
                  Boolean(actionLabel);

                return (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between gap-2 p-2.5 rounded-xl text-xs transition-colors ${
                      isSelected
                        ? 'bg-primary-500/10 text-primary-900 dark:text-primary-100 border border-primary-500/30'
                        : !selectable || (!isSelected && isAtLimit)
                        ? 'opacity-70 bg-transparent'
                        : 'hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-800 dark:text-surface-200'
                    }`}
                  >
                    <label
                      className={`flex items-center gap-2 min-w-0 flex-1 select-none ${
                        disabled ? 'cursor-not-allowed' : 'cursor-pointer'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={disabled}
                        onChange={() => void handleToggleItem(item)}
                        aria-label={item.title || translateRecentFeature("i18nAudit.ui.untitled-document.63e74bd4")}
                        className="rounded text-primary-600 focus:ring-primary-500"
                      />
                      <FileText size={16} aria-hidden="true" className="text-surface-400 flex-shrink-0" />
                      <span className="truncate font-medium">
                        {item.title || translateRecentFeature("i18nAudit.ui.untitled-document.63e74bd4")}
                      </span>
                      <span className="flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-surface-200/70 dark:bg-surface-700/70 text-surface-600 dark:text-surface-300">
                        {sourceCategoryLabel(item.sourceCategory)}
                      </span>
                      {badge && (
                        <span
                          title={item.readinessReason}
                          className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            item.readiness === 'ai-excluded'
                              ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                              : item.readiness === 'local-only'
                              ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
                              : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {badge}
                        </span>
                      )}
                    </label>

                    {isConsentPrep && actionLabel && (
                      <button
                        type="button"
                        disabled={preparingId === item.id}
                        onClick={(e) => void handlePrepare(e, item)}
                        className="flex-shrink-0 rounded-lg border border-primary-500/40 bg-primary-500/10 px-2 py-1 text-[11px] font-semibold text-primary-700 dark:text-primary-300 hover:bg-primary-500/20 disabled:opacity-50"
                      >
                        {preparingId === item.id ? translateRecentFeature("studyPlans.ui.working") : actionLabel}
                      </button>
                    )}
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
