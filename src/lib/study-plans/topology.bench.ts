/** C8-T07 topology bench: worst-supported 100 manual nodes / 24 generated. */
import { bench } from 'vitest';
import { seededRandom } from '../../test/bench-support';
import { orderStudyPlan } from './topology';

const rand = seededRandom(0xc80701);
const nodes = Array.from({ length: 100 }, (_, i) => ({
  nodeId: `n${i}`,
  title: `Topic ${i}`,
  summary: '',
  learningObjectives: ['Objective one'],
  conceptId: null,
  conceptLabel: '',
  position: i,
  included: true,
  locked: false,
  userAdded: false,
  userModified: false,
  materialSupport: 'grounded',
  whyHere: null,
  sourceRefIds: [],
}));
const prereqs = Array.from({ length: 60 }, () => ({
  prerequisiteNodeId: `n${Math.floor(rand() * 50)}`,
  dependentNodeId: `n${50 + Math.floor(rand() * 50)}`,
  support: 'inferred',
  rationale: 'r',
  sourceRefIds: [],
}));

let sink: unknown;
bench('study-plans/topology-order-100-nodes', () => {
  sink = orderStudyPlan(nodes as never, prereqs as never);
});
void sink;
