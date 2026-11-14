import { describe, expect, it } from 'vitest';
import { computeStudyPlanGraphLayout } from '../layout';
import { projectStudyPlanGraph } from '../projection';
import { createFutureOfMathFixture, makeNode } from './fixtures';

describe('computeStudyPlanGraphLayout', () => {
  it('produces 100% deterministic coordinates and paths for identical inputs', () => {
    const fixture = createFutureOfMathFixture();
    const proj = projectStudyPlanGraph(fixture);

    const layout1 = computeStudyPlanGraphLayout(proj, { orientation: 'TB' });
    const layout2 = computeStudyPlanGraphLayout(proj, { orientation: 'TB' });

    expect(layout1).toEqual(layout2);
    expect(layout1.mode).toBe('dag');
    expect(layout1.nodes).toHaveLength(13);
    expect(layout1.edges).toHaveLength(fixture.prerequisites.length);
  });

  it('enforces directed topological placement in both TB and LR orientations without node overlaps', () => {
    const fixture = createFutureOfMathFixture();
    const proj = projectStudyPlanGraph(fixture);

    for (const orientation of ['TB', 'LR'] as const) {
      const layout = computeStudyPlanGraphLayout(proj, { orientation });
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);

      for (const pe of layout.edges) {
        const src = layout.nodePositionById[pe.edge.prerequisiteNodeId];
        const tgt = layout.nodePositionById[pe.edge.dependentNodeId];
        if (orientation === 'TB') {
          expect(src.y).toBeLessThan(tgt.y);
        } else {
          expect(src.x).toBeLessThan(tgt.x);
        }
        expect(Number.isFinite(pe.sourceX)).toBe(true);
        expect(Number.isFinite(pe.targetY)).toBe(true);
        expect(pe.pathD.startsWith('M ')).toBe(true);
      }

      // Check zero axis-aligned bounding box overlaps across all positioned nodes
      for (let i = 0; i < layout.nodes.length; i++) {
        for (let j = i + 1; j < layout.nodes.length; j++) {
          const a = layout.nodes[i];
          const b = layout.nodes[j];
          const overlapsX = a.x < b.x + b.width && a.x + a.width > b.x;
          const overlapsY = a.y < b.y + b.height && a.y + a.height > b.y;
          expect(overlapsX && overlapsY).toBe(false);
        }
      }
    }
  });

  it('uses ordered roadmap mode when zero prerequisites exist', () => {
    const nodes = Array.from({ length: 8 }, (_, i) => makeNode(`n${i}`, `Topic ${i + 1}`, i));
    const proj = projectStudyPlanGraph({ nodes, prerequisites: [] });
    const layout = computeStudyPlanGraphLayout(proj, { orientation: 'TB' });

    expect(layout.mode).toBe('roadmap-no-prerequisites');
    expect(layout.edges).toEqual([]);
    expect(layout.nodes).toHaveLength(8);
  });

  it('renders Source Coverage nodes and edges without conflating them with prerequisites', () => {
    const fixture = createFutureOfMathFixture();
    const proj = projectStudyPlanGraph(fixture);
    const layout = computeStudyPlanGraphLayout(proj, { orientation: 'TB', viewLayer: 'sources' });

    expect(layout.sourceNodes.length).toBe(5);
    expect(layout.sourceEdges.length).toBeGreaterThan(0);
    for (const sn of layout.sourceNodes) {
      expect(Number.isFinite(sn.x)).toBe(true);
      expect(Number.isFinite(sn.y)).toBe(true);
    }
  });

  it('lays out a 100-topic complex DAG deterministically in under 50ms', () => {
    const nodes = Array.from({ length: 100 }, (_, i) => makeNode(`n${i}`, `Topic ${i + 1}`, i));
    const prerequisites = [];
    for (let i = 0; i < 80; i++) {
      prerequisites.push({
        prerequisiteNodeId: `n${i}`,
        dependentNodeId: `n${i + 10 + (i % 7)}`,
        support: (i % 3 === 0 ? 'user' : 'inferred') as 'user' | 'inferred',
        rationale: null,
        sourceRefIds: [],
      });
    }
    const proj = projectStudyPlanGraph({ nodes, prerequisites });
    const start = performance.now();
    const layout = computeStudyPlanGraphLayout(proj, { orientation: 'LR' });
    const elapsed = performance.now() - start;

    expect(layout.nodes).toHaveLength(100);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(150);
  });
});
