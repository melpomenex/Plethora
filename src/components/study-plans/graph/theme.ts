/**
 * Theme-aware token helpers for the Study Plan Graph View.
 *
 * Uses Plethora's live CSS custom properties (applied to :root by ThemeContext
 * and defaulted in src/index.css) so components automatically adapt to Light,
 * Dark, OLED, Legal Pad, Glass, and custom themes without requiring a
 * ThemeProvider wrapper in unit tests and without WebKitGTK-unsafe CSS.
 */

import type { NodeActivity, PlanPrerequisite } from '../../../types/learningPaths';
import type { MasteryEvidenceLevel } from '../../../types/learningEvidence';
import type { SourceHealthStatus } from '../../../lib/study-plans/graph/types';

export interface GraphSurfaceTokens {
  canvasBackground: string;
  dotGridColor: string;
  nodeSurface: string;
  nodeExcludedSurface: string;
  panelSurface: string;
  panelElevatedSurface: string;
  borderSubtle: string;
  borderStrong: string;
  textPrimary: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  success: string;
  warning: string;
  errorAccent: string;
  errorContainer: string;
  onErrorContainer: string;
  tertiary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
}

export function getGraphSurfaceTokens(): GraphSurfaceTokens {
  return {
    canvasBackground: 'var(--color-surface-container-lowest, var(--color-background, #ffffff))',
    dotGridColor: 'var(--color-outline-variant, var(--color-border, #cbd5e1))',
    nodeSurface: 'var(--color-card, var(--color-surface, #ffffff))',
    nodeExcludedSurface: 'var(--color-surface-container-low, var(--color-muted, #f1f5f9))',
    panelSurface: 'var(--color-surface-container, var(--color-card, #ffffff))',
    panelElevatedSurface: 'var(--color-surface-container-high, var(--color-popover, #ffffff))',
    borderSubtle: 'var(--color-outline-variant, var(--color-border, #e2e8f0))',
    borderStrong: 'var(--color-outline, var(--color-border, #64748b))',
    textPrimary: 'var(--color-on-surface, var(--color-card-foreground, #0f172a))',
    textMuted: 'var(--color-on-surface-variant, var(--color-muted-foreground, #475569))',
    primary: 'var(--color-primary, #3b82f6)',
    onPrimary: 'var(--color-on-primary, #ffffff)',
    primaryContainer: 'var(--color-primary-container, #dbeafe)',
    onPrimaryContainer: 'var(--color-on-primary-container, #1e3a5f)',
    success: 'var(--color-success, #15803d)',
    warning: 'var(--color-warning, #f59e0b)',
    errorAccent: 'var(--color-error, #b3261e)',
    errorContainer: 'var(--color-error-container, #f9dedc)',
    onErrorContainer: 'var(--color-on-error-container, #410e0b)',
    tertiary: 'var(--color-tertiary, #7c4dbe)',
    secondaryContainer: 'var(--color-secondary-container, #e8e8ec)',
    onSecondaryContainer: 'var(--color-on-secondary-container, #1d1b20)',
  };
}

export interface ActivityVisualStyle {
  accentColor: string;
  surfaceTint: string;
  textColor: string;
  borderColor: string;
}

export function getActivityStyle(activity: NodeActivity): ActivityVisualStyle {
  switch (activity) {
    case 'completed':
      return {
        accentColor: 'var(--color-success, #15803d)',
        surfaceTint: 'var(--color-surface-container, var(--color-card))',
        textColor: 'var(--color-success, #15803d)',
        borderColor: 'var(--color-success, #15803d)',
      };
    case 'in-progress':
      return {
        accentColor: 'var(--color-primary, #3b82f6)',
        surfaceTint: 'var(--color-primary-container, var(--color-surface-container))',
        textColor: 'var(--color-primary, #3b82f6)',
        borderColor: 'var(--color-primary, #3b82f6)',
      };
    case 'skipped':
      return {
        accentColor: 'var(--color-warning, #f59e0b)',
        surfaceTint: 'var(--color-surface-container, var(--color-card))',
        textColor: 'var(--color-warning, #f59e0b)',
        borderColor: 'var(--color-warning, #f59e0b)',
      };
    case 'not-started':
    default:
      return {
        accentColor: 'var(--color-on-surface-variant, var(--color-muted-foreground))',
        surfaceTint: 'var(--color-surface-container-low, var(--color-surface))',
        textColor: 'var(--color-on-surface-variant, var(--color-muted-foreground))',
        borderColor: 'var(--color-outline-variant, var(--color-border))',
      };
  }
}

export interface EdgeVisualStyle {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  opacity: number;
  markerVariant: 'primary' | 'tertiary' | 'muted' | 'warning';
}

export function getEdgeStyle(
  support: PlanPrerequisite['support'],
  options: { highlighted: boolean; selected: boolean; dimmed: boolean }
): EdgeVisualStyle {
  const { highlighted, selected, dimmed } = options;

  const baseOpacity = dimmed ? 0.2 : highlighted || selected ? 1 : 0.72;

  switch (support) {
    case 'user':
      return {
        stroke: 'var(--color-primary, #3b82f6)',
        strokeWidth: selected ? 2.8 : highlighted ? 2.4 : 2.0,
        opacity: dimmed ? 0.22 : highlighted || selected ? 1 : 0.88,
        markerVariant: 'primary',
      };
    case 'confirmed-concept-link':
      return {
        stroke: highlighted || selected
          ? 'var(--color-primary, #3b82f6)'
          : 'var(--color-tertiary, var(--color-primary, #3b82f6))',
        strokeWidth: selected ? 2.6 : highlighted ? 2.2 : 1.75,
        opacity: baseOpacity,
        markerVariant: highlighted || selected ? 'primary' : 'tertiary',
      };
    case 'unsupported':
      return {
        stroke: 'var(--color-warning, var(--color-error, #f59e0b))',
        strokeWidth: selected ? 2.4 : highlighted ? 2.0 : 1.6,
        strokeDasharray: '2.5 3.5',
        opacity: dimmed ? 0.2 : highlighted || selected ? 0.96 : 0.75,
        markerVariant: 'warning',
      };
    case 'inferred':
    default:
      return {
        stroke: highlighted || selected
          ? 'var(--color-primary, #3b82f6)'
          : 'var(--color-outline, var(--color-on-surface-variant, #64748b))',
        strokeWidth: selected ? 2.4 : highlighted ? 2.0 : 1.5,
        strokeDasharray: '6 4',
        opacity: baseOpacity,
        markerVariant: highlighted || selected ? 'primary' : 'muted',
      };
  }
}

export interface SourceHealthVisualStyle {
  accentColor: string;
  containerBg: string;
  containerFg: string;
  hasWarning: boolean;
}

export function getSourceHealthStyle(status: SourceHealthStatus | undefined): SourceHealthVisualStyle {
  switch (status ?? 'unverified') {
    case 'current':
      return {
        accentColor: 'var(--color-success, #15803d)',
        containerBg: 'var(--color-surface-container, var(--color-muted))',
        containerFg: 'var(--color-on-surface-variant, var(--color-muted-foreground))',
        hasWarning: false,
      };
    case 'missing':
    case 'unsupported':
      return {
        accentColor: 'var(--color-error, #b3261e)',
        containerBg: 'var(--color-error-container, var(--color-surface-container))',
        containerFg: 'var(--color-on-error-container, var(--color-error))',
        hasWarning: true,
      };
    case 'stale':
    case 'ambiguous':
    case 'unverified':
      return {
        accentColor: 'var(--color-warning, #f59e0b)',
        containerBg: 'var(--color-surface-container-high, var(--color-surface-container))',
        containerFg: 'var(--color-warning, #f59e0b)',
        hasWarning: true,
      };
    case 'none':
    default:
      return {
        accentColor: 'var(--color-on-surface-variant, var(--color-muted-foreground))',
        containerBg: 'var(--color-surface-container-low, var(--color-muted))',
        containerFg: 'var(--color-on-surface-variant, var(--color-muted-foreground))',
        hasWarning: false,
      };
  }
}

export function getMasteryAccentColor(level: MasteryEvidenceLevel | null): string {
  switch (level) {
    case 'demonstrated-consistently':
      return 'var(--color-success, #15803d)';
    case 'developing':
      return 'var(--color-primary, #3b82f6)';
    case 'needs-attention':
      return 'var(--color-warning, #f59e0b)';
    case 'insufficient-evidence':
    default:
      return 'var(--color-on-surface-variant, var(--color-muted-foreground))';
  }
}
