/**
 * Neural-queue spreading-activation propagation pass — the hot path for
 * the "Go neural" creative mode.
 * When the neural queue depletes (< 20 remaining), a pass seeds at the just-
 * studied element and spreads activation through concept / inter-element /
 * descendant / sibling links, inserting neighbors into the queue.
 *
 * The authoritative algorithm is in Rust (`algorithms/neural_queue.rs`); this
 * TS port mirrors the combine/propagation logic so the performance gate (which
 * is TS-only) can measure the propagation pass's complexity over a large
 * seeded tree. The two implementations share the same constants and the same
 * probabilistic-OR combine, validated by the Rust unit tests.
 *
 * Determinism: a ~300-node binary-ish tree is built once from `seededRandom`
 * (fixed seed), and every iteration replays the same propagation, folding the
 * resulting queue together.
 */
import { bench } from "vitest";
import { seededRandom } from "../test/bench-support";

// ── Constants (mirror algorithms/neural_queue.rs) ──────────────────────────
const ACTIVATION = 0.05;
const LINK_CONCEPT = 0.01;
const LINK_INTER_ELEMENT = 0.05;
const LINK_DESCENDANT = 0.1;
const LINK_PARENT = 0.99;
const SIBLING_INITIAL = 0.3;
const SIBLING_GROWTH = 1.1;
const SIBLING_MAX_GENERATIONS = 8;
const DESCENDANT_MAX = 22;
const QUEUE_REFILL_MIN = 20;

/** Probabilistic OR: f(x,y) = x + y - xy, bounded [0,1]. */
function combine(x: number, y: number): number {
  return x + y - x * y;
}

interface TreeNode {
  id: number;
  parentId: number | null;
  children: number[];
  siblings: number[];
  interLinks: number[];
  intrinsic: number;
}

/**
 * Build a deterministic ~`nodeCount`-node tree from the seeded PRNG. Each node
 * gets 0–3 children (forming a broad subtree) and its intrinsic priority is
 * drawn from the seeded sequence. Siblings are derived from shared parents.
 */
function buildSeededTree(rng: () => number, nodeCount: number): TreeNode[] {
  const nodes: TreeNode[] = Array.from({ length: nodeCount }, (_, i) => ({
    id: i,
    parentId: null,
    children: [],
    siblings: [],
    interLinks: [],
    intrinsic: rng(),
  }));
  // Assign parents: node 0 is root; each subsequent node attaches under an
  // earlier node (a broadening tree).
  for (let i = 1; i < nodeCount; i++) {
    const parent = Math.floor(rng() * i);
    nodes[i].parentId = parent;
    nodes[parent].children.push(i);
  }
  // Siblings = same parent.
  const byParent = new Map<number, number[]>();
  for (const n of nodes) {
    if (n.parentId !== null) {
      const arr = byParent.get(n.parentId) ?? [];
      arr.push(n.id);
      byParent.set(n.parentId, arr);
    }
  }
  for (const arr of byParent.values()) {
    for (const id of arr) {
      nodes[id].siblings = arr.filter((x) => x !== id);
    }
  }
  // A few random inter-element links.
  for (let i = 0; i < nodeCount; i++) {
    if (rng() < 0.1) {
      const target = Math.floor(rng() * nodeCount);
      if (target !== i) nodes[i].interLinks.push(target);
    }
  }
  return nodes;
}

/** InsertOrUpdate with the monotonicity rule (never demote). */
function insertOrUpdate(
  queue: Map<number, number>,
  id: number,
  newPriority: number,
  intrinsic: number,
): boolean {
  const current = queue.get(id);
  if (current === undefined) {
    queue.set(id, combine(newPriority, intrinsic));
    return true;
  }
  if (newPriority < current) {
    queue.set(id, newPriority);
    return true;
  }
  return false;
}

/** One spreading-activation pass seeded at `seedId` (concept + inter + descendants + siblings). */
function propagationPass(
  nodes: TreeNode[],
  seedId: number,
  queue: Map<number, number>,
): void {
  const seed = nodes[seedId];
  if (!seed) return;

  // Concept links: no concept registry in v1 → skipped (mirrors Rust).

  // Inter-element links.
  for (const neighbor of seed.interLinks) {
    insertOrUpdate(queue, neighbor, combine(ACTIVATION, LINK_INTER_ELEMENT), nodes[neighbor].intrinsic);
  }

  // Descendants (BFS, capped at DESCENDANT_MAX).
  let visited = 0;
  const stack = [...seed.children];
  while (stack.length > 0 && visited < DESCENDANT_MAX) {
    const cur = stack.shift()!;
    insertOrUpdate(queue, cur, combine(ACTIVATION, LINK_DESCENDANT), nodes[cur].intrinsic);
    visited++;
    for (const c of nodes[cur].children) stack.push(c);
  }

  // Parent.
  if (seed.parentId !== null) {
    insertOrUpdate(queue, seed.parentId, combine(ACTIVATION, LINK_PARENT), nodes[seed.parentId].intrinsic);
  }

  // Siblings: walk up to SIBLING_MAX_GENERATIONS, link priority grows ×1.1.
  for (let g = 1; g <= SIBLING_MAX_GENERATIONS; g++) {
    const lp = SIBLING_INITIAL * Math.pow(SIBLING_GROWTH, g);
    const combined = combine(ACTIVATION, lp);
    for (const sib of seed.siblings) {
      insertOrUpdate(queue, sib, combined, nodes[sib].intrinsic);
    }
  }
}

/**
 * Build the neural queue by spreading activation, recursively expanding
 * layers until QUEUE_REFILL_MIN is reached or no more elements are reachable.
 */
function runSpreadingActivation(nodes: TreeNode[], seedId: number): Map<number, number> {
  const queue = new Map<number, number>();
  insertOrUpdate(queue, seedId, ACTIVATION, nodes[seedId].intrinsic);
  propagationPass(nodes, seedId, queue);

  let frontier = [...queue.keys()].filter((id) => id !== seedId);
  const visited = new Set<number>([seedId]);
  while (queue.size < QUEUE_REFILL_MIN && frontier.length > 0) {
    const nextFrontier: number[] = [];
    for (const nodeId of frontier) {
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      const before = queue.size;
      propagationPass(nodes, nodeId, queue);
      if (queue.size > before) {
        for (const id of queue.keys()) {
          if (!visited.has(id)) nextFrontier.push(id);
        }
      }
    }
    if (nextFrontier.length === 0) break;
    frontier = nextFrontier;
  }
  return queue;
}

const rng = seededRandom(0xbead);
const NODE_COUNT = 300;
const tree = buildSeededTree(rng, NODE_COUNT);

// Consumed result sink.
let sink = 0;

bench("neuralQueue/spreading-activation-300-nodes", () => {
  const queue = runSpreadingActivation(tree, 0);
  // Consume the resulting queue so the work is not elided.
  let acc = 0;
  for (const [id, priority] of queue) {
    acc = (acc ^ id ^ Math.floor(priority * 1e6)) | 0;
  }
  sink ^= acc;
});
