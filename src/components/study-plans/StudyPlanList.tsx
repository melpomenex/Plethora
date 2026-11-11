/**
 * Study Plan List and filtering view.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.1
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T08)
 */

import React, { useState, useEffect } from 'react';
import {
  Plus,
  MagnifyingGlass,
  BookOpen,
} from '@phosphor-icons/react';
import { useLearningPathsStore } from '../../stores/learningPathsStore';
import { StudyPlanSummaryCard } from './StudyPlanSummaryCard';
import { LegacyStudyPlanImport } from './LegacyStudyPlanImport';
import { StudyPlanStateNotice } from './StudyPlanStateNotice';
import { Button } from '../md3/Button';
import { studyErrorMessage } from '../../lib/study-plans/studyErrorMessage';

export interface StudyPlanListProps {
  onCreateClick: () => void;
  onOpenPlan: (planId: string) => void;
  onOpenAssessmentHistory?: () => void;
}

export const StudyPlanList: React.FC<StudyPlanListProps> = ({
  onCreateClick,
  onOpenPlan,
  onOpenAssessmentHistory,
}) => {
  const plans = useLearningPathsStore((s) => s.plans);
  const isLoading = useLearningPathsStore((s) => s.isLoading);
  const error = useLearningPathsStore((s) => s.error);
  const loadPlans = useLearningPathsStore((s) => s.loadPlans);
  const archivePlan = useLearningPathsStore((s) => s.archivePlan);
  const deletePlan = useLearningPathsStore((s) => s.deletePlan);

  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [searchQuery, setSearchQuery] = useState('');

  const refreshPlans = () => {
    loadPlans(activeTab === 'archived').catch(() => {});
  };

  useEffect(() => {
    refreshPlans();
  }, [activeTab]);

  const handleArchiveToggle = async (planId: string, currentRevision: number, _isArchived: boolean) => {
    try {
      await archivePlan(planId, currentRevision);
      refreshPlans();
    } catch {
      // Handled in store
    }
  };

  const handleDelete = async (planId: string, currentRevision: number) => {
    try {
      await deletePlan(planId, currentRevision);
      refreshPlans();
    } catch {
      // Handled in store
    }
  };

  const filteredPlans = plans.filter((p) => {
    if (activeTab === 'active' && p.status === 'archived') return false;
    if (activeTab === 'archived' && p.status !== 'archived') return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return p.title.toLowerCase().includes(q) || p.goal.toLowerCase().includes(q);
  });

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Top Header Row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-surface-200 dark:border-surface-700">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">
            Study Plans
          </h1>
          <p className="text-xs text-surface-500 mt-0.5">
            Structured, source-grounded learning curricula and mastery paths.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {onOpenAssessmentHistory && (
            <Button variant="outlined" onClick={onOpenAssessmentHistory}>Assessment history</Button>
          )}
          <Button variant="filled" onClick={onCreateClick} data-testid="create-study-plan-btn">
            <Plus size={18} />
            <span>Create Study Plan</span>
          </Button>
        </div>
      </div>

      {/* Legacy import banner if applicable */}
      <LegacyStudyPlanImport onImportSuccess={refreshPlans} />

      {/* Error state */}
      {error && !isLoading && (
        <StudyPlanStateNotice
          type="storage_failed"
          message={studyErrorMessage(error, 'Could not load Study Plans.')}
          onRetry={refreshPlans}
        />
      )}

      {/* Toolbar row: Search & Tab filter */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <MagnifyingGlass
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search plans by title or goal…"
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            aria-label="Search study plans"
          />
        </div>

        {/* Active vs Archived segmented button */}
        <div
          role="group"
          aria-label="Filter study plans"
          className="flex p-0.5 rounded-xl bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 text-xs font-semibold"
        >
          <button
            type="button"
            onClick={() => setActiveTab('active')}
            className={`px-3 py-1 rounded-lg transition-colors ${
              activeTab === 'active'
                ? 'bg-surface-0 dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm'
                : 'text-surface-500 hover:text-surface-800 dark:hover:text-surface-200'
            }`}
          >
            Active Plans
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('archived')}
            className={`px-3 py-1 rounded-lg transition-colors ${
              activeTab === 'archived'
                ? 'bg-surface-0 dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm'
                : 'text-surface-500 hover:text-surface-800 dark:hover:text-surface-200'
            }`}
          >
            Archived
          </button>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && plans.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-44 rounded-2xl bg-surface-100 dark:bg-surface-800/40 animate-pulse border border-surface-200 dark:border-surface-700"
            />
          ))}
        </div>
      )}

      {/* Empty States */}
      {!isLoading && !error && filteredPlans.length === 0 && (
        <div className="py-16 text-center">
          {searchQuery ? (
            <div className="space-y-3">
              <p className="text-sm text-surface-500">
                No study plans match &ldquo;{searchQuery}&rdquo;.
              </p>
              <Button variant="tonal" size="sm" onClick={() => setSearchQuery('')}>
                Clear Search
              </Button>
            </div>
          ) : activeTab === 'archived' ? (
            <p className="text-sm text-surface-500">No archived study plans.</p>
          ) : (
            <div className="max-w-md mx-auto space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-primary-500/10 text-primary-500 mx-auto flex items-center justify-center">
                <BookOpen size={32} />
              </div>
              <h3 className="text-lg font-bold text-surface-900 dark:text-surface-100">
                No Study Plans Yet
              </h3>
              <p className="text-xs text-surface-600 dark:text-surface-400 leading-relaxed">
                Create a study plan manually from your material; AI is optional. Plan topics,
                manage prerequisites, track your study progress, and take diagnostic assessments.
              </p>
              <Button
                variant="filled"
                onClick={onCreateClick}
              >
                <Plus size={18} />
                <span>Create Your First Plan</span>
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Plan Cards Grid */}
      {!isLoading && filteredPlans.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredPlans.map((plan) => (
            <StudyPlanSummaryCard
              key={plan.id}
              plan={plan}
              onOpen={onOpenPlan}
              onArchive={() => handleArchiveToggle(plan.id, 1, false)}
              onRestore={() => handleArchiveToggle(plan.id, 1, true)}
              onDelete={() => handleDelete(plan.id, 1)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
