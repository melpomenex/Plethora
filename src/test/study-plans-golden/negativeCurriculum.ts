/** C8-T04 curriculum negatives: cycles/dangling/duplicate/locks/version conflicts. */
import { orderStudyPlan } from '../../lib/study-plans/topology';

function node(id: string, pos: number, locked = false, included = true) {
  return { nodeId: id, title: id, summary: '', learningObjectives: ['o'], conceptId: null, conceptLabel: '', position: pos, included, locked, userAdded: false, userModified: false, materialSupport: 'grounded', whyHere: null, sourceRefIds: [] } as never;
}
export const curriculumNegatives = [
  { name: 'cycle N1->N2->N1', run: () => orderStudyPlan([node('a', 0), node('b', 1)], [{ prerequisiteNodeId: 'a', dependentNodeId: 'b', support: 'inferred', rationale: 'r', sourceRefIds: [] }, { prerequisiteNodeId: 'b', dependentNodeId: 'a', support: 'inferred', rationale: 'r', sourceRefIds: [] }] as never).ok === false },
  { name: 'self-edge', run: () => orderStudyPlan([node('a', 0)], [{ prerequisiteNodeId: 'a', dependentNodeId: 'a', support: 'inferred', rationale: 'r', sourceRefIds: [] }] as never).ok === false },
  { name: 'dangling endpoint', run: () => orderStudyPlan([node('a', 0)], [{ prerequisiteNodeId: 'a', dependentNodeId: 'zz', support: 'inferred', rationale: 'r', sourceRefIds: [] }] as never).ok === false },
  { name: 'duplicate edge', run: () => orderStudyPlan([node('a', 0), node('b', 1)], [{ prerequisiteNodeId: 'a', dependentNodeId: 'b', support: 'inferred', rationale: 'r', sourceRefIds: [] }, { prerequisiteNodeId: 'a', dependentNodeId: 'b', support: 'inferred', rationale: 'r', sourceRefIds: [] }] as never).ok === false },
  { name: 'edge touches tombstone', run: () => orderStudyPlan([node('a', 0), node('b', -1, false, false)], [{ prerequisiteNodeId: 'a', dependentNodeId: 'b', support: 'inferred', rationale: 'r', sourceRefIds: [] }] as never).ok === false },
];
