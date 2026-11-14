import React from 'react';
import {
  ArrowsOut,
  CaretLeft,
  CaretRight,
  GitBranch,
  LinkSimple,
  ListBullets,
  MagnifyingGlass,
  MapTrifold,
  Minus,
  Plus,
  Rows,
  Columns,
  Sparkle,
  Info,
  X,
  BookOpen,
  Eye,
} from '@phosphor-icons/react';
import type {
  GraphOrientation,
  GraphViewLayer,
  PrerequisiteSupportFilter,
} from '../../../lib/study-plans/graph/types';
import { t, useI18n } from '../../../lib/i18n';
import { getGraphSurfaceTokens } from './theme';

export type OutlineViewMode = 'list' | 'graph';

export interface StudyPlanOutlineModeSwitchProps {
  mode: OutlineViewMode;
  onChangeMode: (mode: OutlineViewMode) => void;
}

export const StudyPlanOutlineModeSwitch: React.FC<StudyPlanOutlineModeSwitchProps> = ({
  mode,
  onChangeMode,
}) => {
  useI18n();
  const tokens = getGraphSurfaceTokens();

  return (
    <div
      role="group"
      aria-label={t('studyPlans.graph.viewModeSwitcher')}
      className="inline-flex items-center p-0.5 rounded-xl border"
      style={{
        backgroundColor: tokens.panelSurface,
        borderColor: tokens.borderSubtle,
      }}
    >
      <button
        type="button"
        data-testid="study-plan-outline-mode-list"
        aria-pressed={mode === 'list'}
        onClick={() => onChangeMode('list')}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
        style={
          mode === 'list'
            ? {
                backgroundColor: tokens.primaryContainer,
                color: tokens.onPrimaryContainer,
              }
            : {
                backgroundColor: 'transparent',
                color: tokens.textMuted,
              }
        }
      >
        <ListBullets size={15} weight={mode === 'list' ? 'bold' : 'regular'} aria-hidden="true" />
        <span>{t('studyPlans.graph.modeList')}</span>
      </button>
      <button
        type="button"
        data-testid="study-plan-outline-mode-graph"
        aria-pressed={mode === 'graph'}
        onClick={() => onChangeMode('graph')}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
        style={
          mode === 'graph'
            ? {
                backgroundColor: tokens.primaryContainer,
                color: tokens.onPrimaryContainer,
              }
            : {
                backgroundColor: 'transparent',
                color: tokens.textMuted,
              }
        }
      >
        <GitBranch size={15} weight={mode === 'graph' ? 'bold' : 'regular'} aria-hidden="true" />
        <span>{t('studyPlans.graph.modeGraph')}</span>
      </button>
    </div>
  );
};

export interface StudyPlanGraphToolbarProps {
  mode: OutlineViewMode;
  onChangeMode?: (mode: OutlineViewMode) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchMatchCount: number;
  activeSearchIndex: number;
  onPrevSearchMatch: () => void;
  onNextSearchMatch: () => void;
  supportFilter: PrerequisiteSupportFilter;
  onSupportFilterChange: (filter: PrerequisiteSupportFilter) => void;
  zoom: number;
  onFitView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  orientation: GraphOrientation;
  onToggleOrientation: () => void;
  viewLayer: GraphViewLayer;
  onChangeViewLayer: (layer: GraphViewLayer) => void;
  hasSources: boolean;
  showMinimap: boolean;
  onToggleMinimap: () => void;
  showLegend: boolean;
  onToggleLegend: () => void;
  hasRecommendedNext: boolean;
  isNextHighlighted: boolean;
  onHighlightRecommendedNext: () => void;
  isReadOnly: boolean;
  isConnectMode: boolean;
  onToggleConnectMode: () => void;
  canAddTopic: boolean;
  onAddTopic: () => void;
  excludedNodeCount: number;
  includeExcluded: boolean;
  onToggleIncludeExcluded: () => void;
}

export const StudyPlanGraphToolbar: React.FC<StudyPlanGraphToolbarProps> = ({
  mode,
  onChangeMode,
  searchInputRef,
  searchQuery,
  onSearchChange,
  searchMatchCount,
  activeSearchIndex,
  onPrevSearchMatch,
  onNextSearchMatch,
  supportFilter,
  onSupportFilterChange,
  zoom,
  onFitView,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  orientation,
  onToggleOrientation,
  viewLayer,
  onChangeViewLayer,
  hasSources,
  showMinimap,
  onToggleMinimap,
  showLegend,
  onToggleLegend,
  hasRecommendedNext,
  isNextHighlighted,
  onHighlightRecommendedNext,
  isReadOnly,
  isConnectMode,
  onToggleConnectMode,
  canAddTopic,
  onAddTopic,
  excludedNodeCount,
  includeExcluded,
  onToggleIncludeExcluded,
}) => {
  useI18n();
  const tokens = getGraphSurfaceTokens();
  const hasSearchText = searchQuery.trim().length > 0;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl border"
      style={{
        backgroundColor: tokens.panelSurface,
        borderColor: tokens.borderSubtle,
      }}
    >
      {/* Left: View mode switcher (when hosted inline) + Search + Filter */}
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        {onChangeMode && (
          <StudyPlanOutlineModeSwitch mode={mode} onChangeMode={onChangeMode} />
        )}

        {/* Search Input */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border min-w-[200px] sm:min-w-[230px]"
          style={{
            backgroundColor: tokens.nodeSurface,
            borderColor: tokens.borderSubtle,
          }}
        >
          <MagnifyingGlass size={14} style={{ color: tokens.textMuted }} aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchMatchCount > 0) {
                e.preventDefault();
                if (e.shiftKey) {
                  onPrevSearchMatch();
                } else {
                  onNextSearchMatch();
                }
              } else if (e.key === 'Escape' && hasSearchText) {
                e.preventDefault();
                onSearchChange('');
              }
            }}
            placeholder={t('studyPlans.graph.searchPlaceholder')}
            aria-label={t('studyPlans.graph.searchAria')}
            className="bg-transparent text-xs outline-none flex-1 min-w-0"
            style={{ color: tokens.textPrimary }}
          />
          {hasSearchText && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <span className="text-[10px] tabular-nums px-1" style={{ color: tokens.textMuted }}>
                {searchMatchCount > 0
                  ? t('studyPlans.graph.searchCount', {
                      var0: activeSearchIndex + 1,
                      var1: searchMatchCount,
                    })
                  : t('studyPlans.graph.searchNoMatches')}
              </span>
              {searchMatchCount > 1 && (
                <>
                  <button
                    type="button"
                    onClick={onPrevSearchMatch}
                    aria-label={t('studyPlans.graph.searchPrev')}
                    className="p-0.5 rounded hover:opacity-80 cursor-pointer"
                    style={{ color: tokens.textMuted }}
                  >
                    <CaretLeft size={12} weight="bold" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={onNextSearchMatch}
                    aria-label={t('studyPlans.graph.searchNext')}
                    className="p-0.5 rounded hover:opacity-80 cursor-pointer"
                    style={{ color: tokens.textMuted }}
                  >
                    <CaretRight size={12} weight="bold" aria-hidden="true" />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label={t('studyPlans.graph.searchClear')}
                className="p-0.5 rounded hover:opacity-80 cursor-pointer"
                style={{ color: tokens.textMuted }}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        {/* Prerequisite Support Filter */}
        <select
          value={supportFilter}
          onChange={(e) => onSupportFilterChange(e.target.value as PrerequisiteSupportFilter)}
          aria-label={t('studyPlans.graph.prereqFilterAria')}
          className="px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer outline-none"
          style={{
            backgroundColor: tokens.nodeSurface,
            borderColor: tokens.borderSubtle,
            color: tokens.textPrimary,
          }}
        >
          <option value="all">{t('studyPlans.graph.filterAllPrereqs')}</option>
          <option value="user">{t('studyPlans.graph.filterUserPrereqs')}</option>
          <option value="confirmed-concept-link">
            {t('studyPlans.graph.filterConfirmedPrereqs')}
          </option>
          <option value="inferred">{t('studyPlans.graph.filterInferredPrereqs')}</option>
          <option value="unsupported">{t('studyPlans.graph.filterUnsupportedPrereqs')}</option>
        </select>

        {/* Graph Layer Toggle */}
        {hasSources && (
          <div
            role="group"
            aria-label={t('studyPlans.graph.layerAria')}
            className="inline-flex items-center p-0.5 rounded-lg border"
            style={{
              backgroundColor: tokens.nodeSurface,
              borderColor: tokens.borderSubtle,
            }}
          >
            <button
              type="button"
              data-testid="study-plan-graph-layer-curriculum"
              aria-pressed={viewLayer !== 'sources'}
              onClick={() => onChangeViewLayer('curriculum')}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium cursor-pointer"
              style={
                viewLayer !== 'sources'
                  ? {
                      backgroundColor: tokens.primaryContainer,
                      color: tokens.onPrimaryContainer,
                    }
                  : { color: tokens.textMuted }
              }
            >
              <span>{t('studyPlans.graph.layerCurriculum')}</span>
            </button>
            <button
              type="button"
              data-testid="study-plan-graph-layer-sources"
              aria-pressed={viewLayer === 'sources'}
              onClick={() => onChangeViewLayer('sources')}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium cursor-pointer"
              style={
                viewLayer === 'sources'
                  ? {
                      backgroundColor: tokens.primaryContainer,
                      color: tokens.onPrimaryContainer,
                    }
                  : { color: tokens.textMuted }
              }
            >
              <BookOpen size={13} aria-hidden="true" />
              <span>{t('studyPlans.graph.layerSources')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Right: Viewport Controls, Layout Orientation, Helpers, Draft Actions */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Fit */}
        <button
          type="button"
          data-testid="study-plan-graph-fit"
          onClick={onFitView}
          aria-label={t('studyPlans.graph.fitAria')}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer hover:opacity-90"
          style={{
            backgroundColor: tokens.nodeSurface,
            borderColor: tokens.borderSubtle,
            color: tokens.textPrimary,
          }}
        >
          <ArrowsOut size={13} aria-hidden="true" />
          <span>{t('studyPlans.graph.fit')}</span>
        </button>

        {/* Zoom Cluster */}
        <div
          className="inline-flex items-center rounded-lg border overflow-hidden"
          style={{
            backgroundColor: tokens.nodeSurface,
            borderColor: tokens.borderSubtle,
          }}
        >
          <button
            type="button"
            data-testid="study-plan-graph-zoom-out"
            onClick={onZoomOut}
            aria-label={t('studyPlans.graph.zoomOut')}
            className="px-2 py-1.5 text-xs cursor-pointer hover:opacity-80"
            style={{ color: tokens.textPrimary }}
          >
            <Minus size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            data-testid="study-plan-graph-zoom-reset"
            onClick={onResetZoom}
            aria-label={t('studyPlans.graph.resetZoom')}
            className="px-2 py-1.5 text-xs font-medium tabular-nums border-x cursor-pointer hover:opacity-80"
            style={{
              color: tokens.textPrimary,
              borderColor: tokens.borderSubtle,
            }}
          >
            {t('studyPlans.graph.zoomLevelLabel', { var0: Math.round(zoom * 100) })}
          </button>
          <button
            type="button"
            data-testid="study-plan-graph-zoom-in"
            onClick={onZoomIn}
            aria-label={t('studyPlans.graph.zoomIn')}
            className="px-2 py-1.5 text-xs cursor-pointer hover:opacity-80"
            style={{ color: tokens.textPrimary }}
          >
            <Plus size={13} aria-hidden="true" />
          </button>
        </div>

        {/* Orientation Toggle */}
        <button
          type="button"
          data-testid="study-plan-graph-orientation"
          onClick={onToggleOrientation}
          aria-label={t('studyPlans.graph.orientationAria')}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer hover:opacity-90"
          style={{
            backgroundColor: tokens.nodeSurface,
            borderColor: tokens.borderSubtle,
            color: tokens.textPrimary,
          }}
        >
          {orientation === 'TB' ? (
            <Rows size={14} aria-hidden="true" />
          ) : (
            <Columns size={14} aria-hidden="true" />
          )}
          <span className="hidden sm:inline">
            {orientation === 'TB'
              ? t('studyPlans.graph.orientationTB')
              : t('studyPlans.graph.orientationLR')}
          </span>
        </button>

        {/* Next Recommended Topic */}
        {hasRecommendedNext && (
          <button
            type="button"
            data-testid="study-plan-graph-next-topic"
            onClick={onHighlightRecommendedNext}
            aria-pressed={isNextHighlighted}
            aria-label={t('studyPlans.graph.highlightNextAria')}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer hover:opacity-90"
            style={
              isNextHighlighted
                ? {
                    backgroundColor: tokens.primaryContainer,
                    borderColor: tokens.primary,
                    color: tokens.onPrimaryContainer,
                  }
                : {
                    backgroundColor: tokens.nodeSurface,
                    borderColor: tokens.borderSubtle,
                    color: tokens.textPrimary,
                  }
            }
          >
            <Sparkle size={13} weight="fill" aria-hidden="true" />
            <span className="hidden md:inline">{t('studyPlans.graph.highlightNext')}</span>
          </button>
        )}

        {/* Excluded Nodes Toggle (when tombstones exist) */}
        {excludedNodeCount > 0 && (
          <button
            type="button"
            onClick={onToggleIncludeExcluded}
            aria-pressed={includeExcluded}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer hover:opacity-90"
            style={
              includeExcluded
                ? {
                    backgroundColor: tokens.secondaryContainer,
                    borderColor: tokens.borderStrong,
                    color: tokens.onSecondaryContainer,
                  }
                : {
                    backgroundColor: tokens.nodeSurface,
                    borderColor: tokens.borderSubtle,
                    color: tokens.textMuted,
                  }
            }
          >
            <Eye size={13} aria-hidden="true" />
            <span>{t('studyPlans.graph.includeExcluded')}</span>
          </button>
        )}

        {/* Draft Actions: Connect prerequisite & Add Topic */}
        {!isReadOnly && (
          <>
            <button
              type="button"
              data-testid="study-plan-graph-connect"
              onClick={onToggleConnectMode}
              aria-pressed={isConnectMode}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer hover:opacity-90"
              style={
                isConnectMode
                  ? {
                      backgroundColor: tokens.primaryContainer,
                      borderColor: tokens.primary,
                      color: tokens.onPrimaryContainer,
                    }
                  : {
                      backgroundColor: tokens.nodeSurface,
                      borderColor: tokens.borderSubtle,
                      color: tokens.textPrimary,
                    }
              }
            >
              <LinkSimple size={13} aria-hidden="true" />
              <span className="hidden md:inline">
                {isConnectMode
                  ? t('studyPlans.graph.cancelConnect')
                  : t('studyPlans.graph.connectPrereq')}
              </span>
            </button>

            {canAddTopic && (
              <button
                type="button"
                data-testid="study-plan-graph-add-topic"
                onClick={onAddTopic}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer hover:opacity-90"
                style={{
                  backgroundColor: tokens.nodeSurface,
                  borderColor: tokens.borderSubtle,
                  color: tokens.textPrimary,
                }}
              >
                <Plus size={13} aria-hidden="true" />
                <span className="hidden lg:inline">{t('studyPlans.graph.addTopic')}</span>
              </button>
            )}
          </>
        )}

        {/* Minimap & Legend Toggles */}
        <button
          type="button"
          data-testid="study-plan-graph-toggle-minimap"
          onClick={onToggleMinimap}
          aria-pressed={showMinimap}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer hover:opacity-90"
          style={
            showMinimap
              ? {
                  backgroundColor: tokens.primaryContainer,
                  borderColor: tokens.primary,
                  color: tokens.onPrimaryContainer,
                }
              : {
                  backgroundColor: tokens.nodeSurface,
                  borderColor: tokens.borderSubtle,
                  color: tokens.textMuted,
                }
          }
        >
          <MapTrifold size={14} aria-hidden="true" />
          <span className="hidden xl:inline">{t('studyPlans.graph.minimap')}</span>
        </button>

        <button
          type="button"
          data-testid="study-plan-graph-toggle-legend"
          onClick={onToggleLegend}
          aria-pressed={showLegend}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer hover:opacity-90"
          style={
            showLegend
              ? {
                  backgroundColor: tokens.primaryContainer,
                  borderColor: tokens.primary,
                  color: tokens.onPrimaryContainer,
                }
              : {
                  backgroundColor: tokens.nodeSurface,
                  borderColor: tokens.borderSubtle,
                  color: tokens.textMuted,
                }
          }
        >
          <Info size={14} aria-hidden="true" />
          <span className="hidden xl:inline">{t('studyPlans.graph.legend')}</span>
        </button>
      </div>
    </div>
  );
};
