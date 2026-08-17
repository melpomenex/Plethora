---
name: gauntlet
description: Run a bounded, evidence-driven Gauntlet debugging loop. Decomposes bugs along pipeline boundaries, enforces strict hypothesis testing and adversarial verification, and caps mutations to prevent runaway loops.
license: MIT
metadata:
  author: incrementum
  version: "2.0"
---

# Bounded Gauntlet: Evidence-Driven Debugging & Quality Loop

A rigorous, bounded build-and-critique loop designed for hard debugging, rendering, and engineering problems. It replaces open-ended wandering with strict boundary isolation, falsifiable hypotheses, minimal mutations, and adversarial verification.

---

## Operating Roles

When executing the Gauntlet, assume or fan out three distinct perspectives:

1. **Investigator (Lead)**: Maps the pipeline, isolates failing boundaries, and formulates at most 3 ranked falsifiable hypotheses before touching code.
2. **Implementer (Builder)**: Applies the minimal surgical patch to test or fix exactly one hypothesis.
3. **Adversarial Verifier (Critic)**: Actively tries to disprove the fix against real user-visible acceptance criteria (not intermediate mocks or logs), testing edge cases and mobile behavior.

*Note*: If subagents are not spawned concurrently, simulate these roles serially (`Investigator → Implementer → Adversarial Verifier`).

---

## The 6-Stage Bounded Procedure

### Stage 0: Define Victory
Translate the goal into observable, user-visible acceptance criteria.
- Explicitly distinguish **intermediate evidence** (e.g. `figureDetected == true`, `assetKey != null`, code compiles) from **actual user-visible success** (e.g. rendered pixels visible, non-zero natural dimensions, selectable text around figure).
- Lock the criteria before inspecting code.

### Stage 1: Bounded Reconnaissance
Perform **one** focused pass tracing the end-to-end data/control path.
- Map the pipeline stages from source input to final user display.
- Formulate up to **3 falsifiable hypotheses**, ranked by:
  1. Likelihood
  2. Evidence already present
  3. Cost of testing

### Stage 2: Boundary Isolation
Identify the first broken pipeline boundary *before* writing broad fixes.
- For each candidate boundary, define:
  - **Hypothesis**: What is broken.
  - **Confirming evidence**: What proves this boundary failed.
  - **Falsifying evidence**: What proves this boundary is intact.
  - **Cheapest experiment**: Minimal diagnostic or fixture to isolate the boundary.
- Do not modify multiple unrelated subsystems simultaneously.

### Stage 3: Minimal Mutation
Each mutation iteration targets **one** falsifiable hypothesis.
- Apply the smallest patch capable of testing or fixing the hypothesis.
- Run the narrowest meaningful test.
- Classify the outcome: `CONFIRMED`, `FALSIFIED`, or `INCONCLUSIVE`.
- Log the iteration in the Iteration Ledger.

### Stage 4: Adversarial Verification (Critic Mode)
After an apparent fix, switch to critic mode to disprove it:
- Is the user-visible acceptance criterion truly met?
- Did we introduce a silent fallback (e.g., placeholder or empty block)?
- Does it work at mobile viewports (e.g. 320px - 430px) without horizontal blowout?
- Are intrinsic and rendered dimensions non-zero?
- Do surrounding elements (text selection, layout, controls) remain intact?
- Are there console or runtime errors?

### Stage 5: Cleanup & Regression Protection
- Remove temporary diagnostic logs, hardcoded probe coordinates, and debug harnesses.
- Retain permanent regression tests asserting end-to-end behavior at the failing boundary.

---

## Hard Anti-Wandering Rules

1. **Hard Iteration Cap**: Maximum **6 mutation iterations** total. If iteration 6 finishes without full victory, stop and produce the final status report.
2. **Subsystem Pivot**: No more than **2 failed mutation attempts** in the same subsystem without new boundary evidence.
3. **No Retries**: Never blindly retry a failing command or identical fix.
4. **Targeted Tests First**: Run targeted tests during mutation; broader regression suites only after root-cause isolation.
5. **No Scope Creep**: No unrelated refactorings, styling redesigns, or unnecessary dependency additions.
6. **Preserve User Changes**: Always verify `git status`; never overwrite user work.

---

## Iteration Ledger Format

Maintain a compact ledger during execution:
```markdown
### ITERATION N
- **Hypothesis**: [Specific boundary failure]
- **Evidence Sought**: [What proves/disproves it]
- **Minimal Change**: [Surgical patch]
- **Test**: [Targeted command or fixture]
- **Observed Result**: [Output / measurements]
- **Verdict**: [CONFIRMED / FALSIFIED / INCONCLUSIVE]
- **Next Boundary**: [Target subsystem]
```
