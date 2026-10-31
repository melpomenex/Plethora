/**
 * Deterministic protocol-failure fixtures (change 1.1): a synthetic ~1,000-
 * token chapter plus provider scripts reproducing the failure classes the
 * change targets. These drive the real loop/runTask (never idealized paths).
 *
 * Baseline failure classes (pre-change behavior, locked here for reference):
 *  - empty body ×2            → turn-budget stop (Failure A)
 *  - invalid (non-JSON)       → repair → InvalidStructuredOutput → invalid-turn
 *    stop (Failure B)
 *  - placeholder echo          → previously ended the run "successfully"
 *  - unknown-tool-only turns   → no-progress ×2 → turn-budget
 *  - valid tool then answer    → healthy run
 *
 * Post-change behavior is asserted in agentProtocolFixtures.test.ts.
 */

/** Synthetic section text ≈1,000 tokens (~4k chars). */
export const SYNTHETIC_CHAPTER_TEXT = [
  "Chapter 1: A Paradox",
  "",
  "The second law of thermodynamics states that the total entropy of an isolated system can never decrease over time. Entropy, in statistical mechanics, is a measure of the number of microscopic configurations that correspond to a macroscopic state. The more configurations, the higher the entropy and the more disorder the system exhibits.",
  "Maxwell's demon is a thought experiment that appears to violate the second law. A tiny intelligent being guards a trapdoor between two chambers of a gas. By opening the door only for fast-moving molecules in one direction and slow-moving molecules in the other, the demon can sort molecules and decrease the total entropy of the gas, apparently without doing work.",
  "The resolution of the paradox lies in the cost of information. To decide which molecules to let through, the demon must measure their speeds, and measuring changes the demon's own state. Landauer's principle asserts that erasing one bit of information requires dissipating at least kT ln 2 of energy as heat, which compensates for the entropy decrease achieved by sorting.",
  "Thus the demon's information-processing is not free: the entropy cost of memory erasure exactly balances the apparent entropy reduction. The demon cannot violate the second law because the measurement and memory operations themselves generate entropy. This insight connects thermodynamics, information theory, and computation into a single coherent picture.",
  "Key formulas: the Shannon entropy H = -Σ p log p; the Gibbs entropy S = -k Σ p log p; and Landauer's bound E_min = kT ln 2. Each plays a role in modern treatments of quantum measurement and the thermodynamics of computation.",
  "For the reader: entropy is not a measure of \"usefulness\" alone; it is a count of accessible microstates. A low-entropy state is one with few possible arrangements, and systems naturally evolve toward the more numerous arrangements. The demon story is the classic gateway to understanding why information is physical.",
  "Consider a simple example: a box divided into two halves containing four indistinguishable gas molecules. The number of ways to place the molecules is largest when they are spread evenly between the halves, so the evenly-spread arrangement has the highest entropy. If all four molecules are squeezed into one half, the entropy is lower, and the system will spontaneously tend back toward the spread-out state.",
  "This combinatorial view explains why entropy never decreases spontaneously: the probability of a macrostate is proportional to the number of microstates that realize it, and overwhelmingly likely macrostates are the ones with the most microstates. The second law is thus a statement about probabilities rather than an absolute physical prohibition.",
  "Historical note: Ludwig Boltzmann inscribed S = k log W on his tombstone. Here W is the number of microstates and k is Boltzmann's constant. This equation is often considered the bridge between the microscopic world of atoms and the macroscopic world of thermodynamics.",
  "In modern information theory, the same mathematics describes communication channels. Shannon's entropy measures the average information content of a message, and the coding theorems bound how much a message can be compressed without loss. The formal similarity is not an accident: both describe counting distinguishable states.",
  "For the student: try deriving the entropy change when two identical ideal gases mix. The naive calculation suggests a nonzero entropy increase even for identical gases, which is the Gibbs paradox. The resolution requires treating identical particles as indistinguishable, showing how deep the connection between counting and entropy runs.",
  "Finally, revisit the demon with these tools: the demon's memory must record which molecules it has sorted. To reset its memory for the next measurement it must erase information, and erasure costs energy per Landauer's principle. The cost is not small; it is exactly the amount needed to keep the second law safe.",
].join("\n");

/** A frozen, simple section record for scoped runs. */
export const SYNTHETIC_SECTION = {
  documentId: "paper-entropy",
  title: "Chapter 1: A Paradox",
  text: SYNTHETIC_CHAPTER_TEXT,
  locator: { sectionId: "ch1" },
};

export type AgentFailureScript =
  | "empty-body"
  | "truncated-json"
  | "placeholder-echo"
  | "unknown-tool-only"
  | "valid-tool-then-answer";

const TURN = (value: unknown): string => JSON.stringify(value);

/**
 * Build a provider script (raw response texts, in order) for a failure class.
 * `empty-body` returns empty content; `truncated-json` cuts a JSON array
 * short; `placeholder-echo` copies the legacy schema example; `unknown-tool-
 * only` calls unregistered tools; `valid-tool-then-answer` runs a healthy
 * retrieval → final-answer sequence.
 */
export function agentFailureScript(kind: AgentFailureScript): string[] {
  switch (kind) {
    case "empty-body":
      // Two consecutive empty bodies: the baseline loop ended with turn-budget;
      // post-change this exercises bounded recovery then agent-protocol.
      return ["", ""];
    case "truncated-json":
      // A JSON array truncated mid-entry (repair sees a bounded excerpt).
      return [
        TURN({ toolCalls: [{ tool: "search_library", input: { query: "entropy" } }] }),
        '{"toolCalls":[{"tool":"propose_flashcard","input":{"question":"Q","answer":"A"}},{"tool":"propose_flashcard","input":{"question":"Q2","answer":"A2"}}',
      ];
    case "placeholder-echo":
      return [
        TURN({
          toolCalls: [{ tool: "tool_name", input: {} }],
          finalAnswer: "string (omit while still calling tools)",
        }),
        TURN({ finalAnswer: "still echoing" }),
      ];
    case "unknown-tool-only":
      return [
        TURN({ toolCalls: [{ tool: "not_a_real_tool", input: {} }] }),
        TURN({ toolCalls: [{ tool: "also_not_real", input: {} }] }),
        TURN({ finalAnswer: "done" }),
      ];
    case "valid-tool-then-answer":
      return [
        TURN({ toolCalls: [{ tool: "search_library", input: { query: "entropy" } }] }),
        TURN({ finalAnswer: "found material" }),
      ];
  }
}
