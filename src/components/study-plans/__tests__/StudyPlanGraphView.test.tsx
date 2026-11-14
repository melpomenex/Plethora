import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { StudyPlanDetail } from '../../../types/learningPaths';
import { createFutureOfMathFixture } from '../../../lib/study-plans/graph/__tests__/fixtures';
import { loadStudyPlanGraphPrefs } from '../../../lib/study-plans/graph/persistence';
import { StudyPlanGraphView } from '../graph/StudyPlanGraphView';
import { StudyPlanEditor } from '../StudyPlanEditor';

vi.mock('../../../api/study-generation', () => ({
  cancelStudyGenerationJob: vi.fn().mockResolvedValue(undefined),
  recoverInterruptedStudyJobs: vi.fn().mockResolvedValue([]),
  listStudyGenerationJobs: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../api/learning-evidence', () => ({
  getStudyPlanEvidence: vi.fn().mockResolvedValue({
    planId: 'plan_math',
    versionId: 'ver_math_1',
    nodes: [],
    activeGapIds: [],
    computedAt: '2026-11-14T00:00:00Z',
  }),
  listLearningGaps: vi.fn().mockResolvedValue([]),
}));

function buildPlanDetail(overrides: {
  planId?: string;
  versionState?: 'draft' | 'published';
  withPrerequisites?: boolean;
} = {}): StudyPlanDetail {
  const {
    planId = 'plan_math',
    versionState = 'draft',
    withPrerequisites = true,
  } = overrides;
  const fixture = createFutureOfMathFixture();

  const scope = {
    documentIds: ['doc_yt', 'doc_chess', 'doc_why', 'doc_ren', 'doc_stale'],
    extractIds: [],
    collectionIds: [],
    tagIds: [],
  };

  return {
    plan: {
      id: planId,
      title: 'Future Of Mathematics',
      goal: 'Understand how AI reshapes mathematical inquiry',
      depth: 'foundational',
      status: versionState === 'published' ? 'active' : 'draft',
      revision: 1,
      draftVersionId: versionState === 'draft' ? 'ver_math_1' : null,
      publishedVersionId: versionState === 'published' ? 'ver_math_1' : null,
      currentVersionId: 'ver_math_1',
      currentVersion: 1,
      archivedAt: null,
      createdAt: '2026-11-14T00:00:00Z',
      updatedAt: '2026-11-14T00:00:00Z',
    } as unknown as StudyPlanDetail['plan'],
    version: {
      id: 'ver_math_1',
      planId,
      version: 1,
      state: versionState,
      baseVersionId: null,
      createdBy: 'ai',
      createdAt: '2026-11-14T00:00:00Z',
      publishedAt: versionState === 'published' ? '2026-11-14T01:00:00Z' : null,
      sourceScope: scope,
      changeSummary: null,
      knowledgeAuthority: {
        kind: 'library-only',
        scope,
      },
      nodes: fixture.nodes,
      prerequisites: withPrerequisites ? fixture.prerequisites : [],
    } as unknown as StudyPlanDetail['version'],
    activityByNodeId: fixture.activityByNodeId,
    sourceRefs: fixture.sourceRefs,
  } as StudyPlanDetail;
}

describe('StudyPlanGraphView', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
  });

  it('renders the 13-topic Future of Mathematics DAG with statuses, stale sources, locks, and confidence edges', () => {
    const detail = buildPlanDetail();
    const { container } = render(
      <StudyPlanGraphView
        planDetail={detail}
        nodes={detail.version.nodes}
        prerequisites={detail.version.prerequisites}
        selectedNodeId="t1"
        onSelectNode={vi.fn()}
        onChangeNodes={vi.fn()}
        onChangeNode={vi.fn()}
        onChangePrerequisites={vi.fn()}
        onChangeActivity={vi.fn()}
        onStartLesson={vi.fn()}
        onOpenSource={vi.fn()}
        isReadOnly={false}
        nodeEvidenceById={{}}
        activeGaps={[{
          id: 'gap_1',
          kind: 'weak_prerequisite',
          conceptId: 'c3',
          conceptName: 'AI Solves Major Problems',
          planId: 'plan_math',
          nodeId: 't3',
          ruleId: 'rule_1',
          status: 'active',
          evidence: [],
          demonstrated: null,
          firstDetectedAt: '2026-11-14T00:00:00Z',
          lastDetectedAt: '2026-11-14T00:00:00Z',
          evidenceCutoff: '2026-11-14T00:00:00Z',
        }]}
      />
    );

    const renderedNodes = container.querySelectorAll('[data-graph-node-id]');
    expect(renderedNodes.length).toBe(13);

    const t1Node = container.querySelector('[data-graph-node-id="t1"]');
    expect(t1Node?.getAttribute('data-selected')).toBe('true');
    expect(t1Node?.textContent).toContain('Framing Questions for the Future of Mathematics');

    const t3Node = container.querySelector('[data-graph-node-id="t3"]');
    expect(t3Node?.textContent).toContain('1 gap(s)');

    const t7Node = container.querySelector('[data-graph-node-id="t7"]');
    expect(t7Node?.textContent).toContain('Stale source');

    const t12Node = container.querySelector('[data-graph-node-id="t12"]');
    expect(t12Node?.innerHTML).toContain('svg'); // Lock icon present

    const edges = container.querySelectorAll('[data-graph-edge-id]');
    expect(edges.length).toBe(detail.version.prerequisites.length);
    expect(container.querySelectorAll('[data-support="user"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-support="confirmed-concept-link"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-support="inferred"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-support="unsupported"]').length).toBeGreaterThan(0);
  });

  it('renders ordered curriculum roadmap with notice banner when there are zero prerequisites', () => {
    const detail = buildPlanDetail({ withPrerequisites: false });
    const { container } = render(
      <StudyPlanGraphView
        planDetail={detail}
        nodes={detail.version.nodes}
        prerequisites={[]}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        onChangeNodes={vi.fn()}
        onChangeNode={vi.fn()}
        onChangePrerequisites={vi.fn()}
        onChangeActivity={vi.fn()}
        onStartLesson={vi.fn()}
        onOpenSource={vi.fn()}
        isReadOnly={false}
      />
    );

    expect(screen.getByTestId('study-plan-graph-no-prereqs-banner')).toBeTruthy();
    expect(container.querySelectorAll('[data-graph-node-id]').length).toBe(13);
    expect(container.querySelectorAll('[data-graph-edge-id]').length).toBe(0);
  });

  it('switches between List and Graph modes in StudyPlanEditor, synchronizes selectedNodeId, and persists mode preference', () => {
    const detail = buildPlanDetail({ planId: 'plan_sync_test' });
    const { container } = render(
      <StudyPlanEditor
        planDetail={detail}
        onBack={vi.fn()}
        onOpenSource={vi.fn()}
      />
    );

    // Starts in List mode by default
    expect(screen.getByTestId('study-plan-outline-mode-list').getAttribute('aria-pressed')).toBe('true');

    // Select Topic 3 in List mode
    const outline = screen.getByLabelText('Ordered study plan topics');
    fireEvent.click(within(outline).getByText('AI Solves Major Problems'));

    // Switch to Graph mode
    fireEvent.click(screen.getByTestId('study-plan-outline-mode-graph'));
    expect(screen.getByTestId('study-plan-graph-view')).toBeTruthy();
    expect(loadStudyPlanGraphPrefs('plan_sync_test').outlineMode).toBe('graph');

    // Topic 3 should remain selected in Graph mode & Inspector
    const t3Node = container.querySelector('[data-graph-node-id="t3"]');
    expect(t3Node?.getAttribute('data-selected')).toBe('true');
    const inspector = screen.getByTestId('study-plan-graph-inspector');
    expect(inspector.textContent).toContain('AI Solves Major Problems');

    // Select Topic 2 in Graph mode
    const t2Node = container.querySelector('[data-graph-node-id="t2"]') as HTMLElement;
    fireEvent.click(t2Node);
    expect(screen.getByTestId('study-plan-graph-inspector').textContent).toContain('Utility & Abstraction');

    // Switch back to List mode -> PlanNodeEditor reflects Topic 2
    fireEvent.click(screen.getByTestId('study-plan-outline-mode-list'));
    expect(loadStudyPlanGraphPrefs('plan_sync_test').outlineMode).toBe('list');
    expect((screen.getByLabelText('Topic Title') as HTMLInputElement).value).toBe('Utility & Abstraction');
  });

  it('supports collapsible inspector, lesson, source, practice, activity control, and full PlanNodeEditor drawer', () => {
    const detail = buildPlanDetail();
    const onSelectNode = vi.fn();
    const onChangeNode = vi.fn();
    const onChangeActivity = vi.fn();
    const onStartLesson = vi.fn();
    const onStartPractice = vi.fn();
    const onOpenSource = vi.fn();

    render(
      <StudyPlanGraphView
        planDetail={detail}
        nodes={detail.version.nodes}
        prerequisites={detail.version.prerequisites}
        selectedNodeId="t1"
        onSelectNode={onSelectNode}
        onChangeNodes={vi.fn()}
        onChangeNode={onChangeNode}
        onChangePrerequisites={vi.fn()}
        onChangeActivity={onChangeActivity}
        onStartLesson={onStartLesson}
        onStartPractice={onStartPractice}
        onOpenSource={onOpenSource}
        isReadOnly={false}
      />
    );

    const inspector = screen.getByTestId('study-plan-graph-inspector');
    expect(inspector.textContent).toContain('Framing Questions for the Future of Mathematics');

    // Start lesson, Open source, Practice
    fireEvent.click(screen.getByTestId('study-plan-graph-inspector-start-lesson'));
    expect(onStartLesson).toHaveBeenCalledWith('t1');

    fireEvent.click(screen.getByTestId('study-plan-graph-inspector-open-source'));
    expect(onOpenSource).toHaveBeenCalledWith('ref_f1', detail.sourceRefs.ref_f1);

    fireEvent.click(screen.getByTestId('study-plan-graph-inspector-practice'));
    expect(onStartPractice).toHaveBeenCalledWith('t1');

    // Change activity directly from inspector
    fireEvent.click(within(inspector).getByRole('button', { name: 'Completed' }));
    expect(onChangeActivity).toHaveBeenCalledWith('t1', 'completed');

    // Open full PlanNodeEditor drawer and modify topic title
    fireEvent.click(screen.getByTestId('study-plan-graph-inspector-edit-topic'));
    const drawer = screen.getByTestId('study-plan-graph-edit-drawer');
    const titleInput = within(drawer).getByLabelText('Topic Title');
    fireEvent.change(titleInput, { target: { value: 'Framing Questions Revised' } });
    expect(onChangeNode).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 't1', title: 'Framing Questions Revised' })
    );
    fireEvent.click(screen.getByTestId('study-plan-graph-edit-drawer-done'));
    expect(screen.queryByTestId('study-plan-graph-edit-drawer')).toBeNull();

    // Close inspector without losing selection callback stability
    fireEvent.click(screen.getByTestId('study-plan-graph-inspector-close'));
    expect(screen.queryByTestId('study-plan-graph-inspector')).toBeNull();
  });

  it('highlights transitive prerequisite path and downstream dependents, and clears highlight', () => {
    const detail = buildPlanDetail();
    const { container } = render(
      <StudyPlanGraphView
        planDetail={detail}
        nodes={detail.version.nodes}
        prerequisites={detail.version.prerequisites}
        selectedNodeId="t7"
        onSelectNode={vi.fn()}
        onChangeNodes={vi.fn()}
        onChangeNode={vi.fn()}
        onChangePrerequisites={vi.fn()}
        onChangeActivity={vi.fn()}
        onStartLesson={vi.fn()}
        onOpenSource={vi.fn()}
        isReadOnly={false}
      />
    );

    fireEvent.click(screen.getByTestId('study-plan-graph-highlight-prereqs'));
    expect(screen.getByTestId('study-plan-graph-highlight-pill')).toBeTruthy();

    // Ancestors of t7 include t1, t2, t3, t4, t5; t13 is unrelated
    expect(container.querySelector('[data-graph-node-id="t5"]')?.getAttribute('data-highlighted')).toBe('true');
    expect(container.querySelector('[data-graph-node-id="t13"]')?.getAttribute('data-highlighted')).toBe('false');

    fireEvent.click(screen.getByTestId('study-plan-graph-clear-highlight'));
    expect(screen.queryByTestId('study-plan-graph-highlight-pill')).toBeNull();

    // Downstream dependents of t7 -> t11 -> t12
    fireEvent.click(screen.getByTestId('study-plan-graph-highlight-dependents'));
    expect(container.querySelector('[data-graph-node-id="t12"]')?.getAttribute('data-highlighted')).toBe('true');
  });

  it('filters search queries cleanly and filters edges by prerequisite support classification', () => {
    const detail = buildPlanDetail();
    const onSelectNode = vi.fn();
    const { container } = render(
      <StudyPlanGraphView
        planDetail={detail}
        nodes={detail.version.nodes}
        prerequisites={detail.version.prerequisites}
        selectedNodeId="t1"
        onSelectNode={onSelectNode}
        onChangeNodes={vi.fn()}
        onChangeNode={vi.fn()}
        onChangePrerequisites={vi.fn()}
        onChangeActivity={vi.fn()}
        onStartLesson={vi.fn()}
        onOpenSource={vi.fn()}
        isReadOnly={false}
      />
    );

    const searchInput = screen.getByLabelText('Search study plan topics');
    fireEvent.change(searchInput, { target: { value: 'Mathematical' } });
    expect(screen.getByText('1 / 2')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Next search match'));
    expect(onSelectNode).toHaveBeenCalled();

    fireEvent.change(searchInput, { target: { value: 'zzzznomatch' } });
    expect(screen.getByText('No matches')).toBeTruthy();

    // Filter edges to unsupported only (only t8 -> t13)
    const filterSelect = screen.getByLabelText('Filter prerequisite relationships');
    fireEvent.change(filterSelect, { target: { value: 'unsupported' } });
    expect(container.querySelectorAll('[data-graph-edge-id]').length).toBe(1);
    expect(container.querySelectorAll('[data-support="unsupported"]').length).toBe(1);
  });

  it('toggles orientation TB/LR, Source Coverage layer, Minimap, Legend, and Zoom while preserving transform on selection', () => {
    const detail = buildPlanDetail({ planId: 'plan_controls' });
    const { container, rerender } = render(
      <StudyPlanGraphView
        planDetail={detail}
        nodes={detail.version.nodes}
        prerequisites={detail.version.prerequisites}
        selectedNodeId="t1"
        onSelectNode={vi.fn()}
        onChangeNodes={vi.fn()}
        onChangeNode={vi.fn()}
        onChangePrerequisites={vi.fn()}
        onChangeActivity={vi.fn()}
        onStartLesson={vi.fn()}
        onOpenSource={vi.fn()}
        isReadOnly={false}
      />
    );

    // Zoom in and check transform stability when selectedNodeId changes
    fireEvent.click(screen.getByTestId('study-plan-graph-zoom-in'));
    const transformBefore = screen.getByTestId('study-plan-graph-transform').getAttribute('style');
    const t2LeftBefore = (container.querySelector('[data-graph-node-id="t2"]') as HTMLElement).style.left;

    rerender(
      <StudyPlanGraphView
        planDetail={detail}
        nodes={detail.version.nodes}
        prerequisites={detail.version.prerequisites}
        selectedNodeId="t2"
        onSelectNode={vi.fn()}
        onChangeNodes={vi.fn()}
        onChangeNode={vi.fn()}
        onChangePrerequisites={vi.fn()}
        onChangeActivity={vi.fn()}
        onStartLesson={vi.fn()}
        onOpenSource={vi.fn()}
        isReadOnly={false}
      />
    );
    expect(screen.getByTestId('study-plan-graph-transform').getAttribute('style')).toBe(transformBefore);
    expect((container.querySelector('[data-graph-node-id="t2"]') as HTMLElement).style.left).toBe(t2LeftBefore);

    // Reset zoom to 100%
    fireEvent.click(screen.getByTestId('study-plan-graph-zoom-reset'));
    expect(screen.getByTestId('study-plan-graph-zoom-reset').textContent).toBe('100%');

    // Toggle orientation TB -> LR
    fireEvent.click(screen.getByTestId('study-plan-graph-orientation'));
    expect(loadStudyPlanGraphPrefs('plan_controls').orientation).toBe('LR');

    // Toggle Minimap & Legend off
    expect(screen.getByTestId('study-plan-graph-minimap')).toBeTruthy();
    expect(screen.getByTestId('study-plan-graph-legend')).toBeTruthy();
    fireEvent.click(screen.getByTestId('study-plan-graph-toggle-minimap'));
    fireEvent.click(screen.getByTestId('study-plan-graph-toggle-legend'));
    expect(screen.queryByTestId('study-plan-graph-minimap')).toBeNull();
    expect(screen.queryByTestId('study-plan-graph-legend')).toBeNull();

    // Switch to Source Coverage layer and click a source node
    fireEvent.click(screen.getByTestId('study-plan-graph-layer-sources'));
    const sourceNodes = container.querySelectorAll('[data-graph-source-id]');
    expect(sourceNodes.length).toBeGreaterThan(0);
    const sourceEdges = container.querySelectorAll('[data-source-edge-id]');
    expect(sourceEdges.length).toBeGreaterThan(0);
    // Source grounding curves never carry prerequisite arrowheads
    expect(sourceEdges[0]?.getAttribute('marker-end')).toBeNull();

    fireEvent.click(sourceNodes[0] as HTMLElement);
    expect(screen.getByTestId('study-plan-graph-inspector').textContent).toContain('Source Document');
  });

  it('adds valid prerequisites and rejects cycles in draft mode, while disabling mutations in published read-only mode', () => {
    const detail = buildPlanDetail();
    const onChangePrerequisites = vi.fn();
    const onChangeNodes = vi.fn();

    const { container, rerender } = render(
      <StudyPlanGraphView
        planDetail={detail}
        nodes={detail.version.nodes}
        prerequisites={detail.version.prerequisites}
        selectedNodeId="t1"
        onSelectNode={vi.fn()}
        onChangeNodes={onChangeNodes}
        onChangeNode={vi.fn()}
        onChangePrerequisites={onChangePrerequisites}
        onChangeActivity={vi.fn()}
        onStartLesson={vi.fn()}
        onOpenSource={vi.fn()}
        isReadOnly={false}
      />
    );

    // Attempt cycle t12 -> t1 via Link prerequisite mode (since t1 -> ... -> t12 exists)
    fireEvent.click(screen.getByTestId('study-plan-graph-connect'));
    expect(screen.getByTestId('study-plan-graph-connect-banner')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-graph-node-id="t12"]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-graph-node-id="t1"]') as HTMLElement);
    expect(screen.getByTestId('study-plan-graph-error-banner')).toBeTruthy();
    expect(onChangePrerequisites).not.toHaveBeenCalled();

    // Valid edge t5 -> t6 via connect mode
    fireEvent.click(container.querySelector('[data-graph-node-id="t5"]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-graph-node-id="t6"]') as HTMLElement);
    expect(onChangePrerequisites).toHaveBeenCalledTimes(1);
    expect(onChangeNodes).toHaveBeenCalledTimes(1);

    // Published read-only mode hides structural authoring controls
    const publishedDetail = buildPlanDetail({ versionState: 'published' });
    rerender(
      <StudyPlanGraphView
        planDetail={publishedDetail}
        nodes={publishedDetail.version.nodes}
        prerequisites={publishedDetail.version.prerequisites}
        selectedNodeId="t7"
        onSelectNode={vi.fn()}
        onChangeNodes={vi.fn()}
        onChangeNode={vi.fn()}
        onChangePrerequisites={vi.fn()}
        onChangeActivity={vi.fn()}
        onStartLesson={vi.fn()}
        onOpenSource={vi.fn()}
        isReadOnly={true}
      />
    );
    expect(screen.queryByTestId('study-plan-graph-connect')).toBeNull();
    expect(screen.queryByTestId('study-plan-graph-add-topic')).toBeNull();
    expect(screen.queryByTestId('study-plan-graph-inspector-add-prereq')).toBeNull();
  });

  it('uses CSS custom properties cleanly across warm light and OLED dark themes without ThemeProvider and supports keyboard controls', () => {
    const detail = buildPlanDetail();
    const onSelectNode = vi.fn();

    document.documentElement.style.setProperty('--color-background', '#f8f1e3');
    document.documentElement.style.setProperty('--color-primary', '#b45309');

    render(
      <StudyPlanGraphView
        planDetail={detail}
        nodes={detail.version.nodes}
        prerequisites={detail.version.prerequisites}
        selectedNodeId="t1"
        onSelectNode={onSelectNode}
        onChangeNodes={vi.fn()}
        onChangeNode={vi.fn()}
        onChangePrerequisites={vi.fn()}
        onChangeActivity={vi.fn()}
        onStartLesson={vi.fn()}
        onOpenSource={vi.fn()}
        isReadOnly={false}
      />
    );

    const canvas = screen.getByTestId('study-plan-graph-canvas');
    expect(canvas.getAttribute('style')).toContain('var(--color-surface-container-lowest');

    // Keyboard zoom & Arrow navigation & Escape close
    fireEvent.keyDown(canvas, { key: '+' });
    expect(screen.getByTestId('study-plan-graph-zoom-reset').textContent).not.toBe('100%');
    fireEvent.keyDown(canvas, { key: '0' });
    expect(screen.getByTestId('study-plan-graph-zoom-reset').textContent).toBe('100%');

    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(onSelectNode).toHaveBeenCalledWith('t2');

    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(screen.queryByTestId('study-plan-graph-inspector')).toBeNull();

    // Switch :root theme variables to OLED dark dynamically without crash
    document.documentElement.style.setProperty('--color-background', '#000000');
    document.documentElement.style.setProperty('--color-primary', '#38bdf8');
    expect(canvas).toBeTruthy();
  });
});
