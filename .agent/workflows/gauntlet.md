---
description: Run a Gauntlet Loop - an iterative build-vs-critique workflow against a concrete quality bar
---

# Gauntlet Loop

Drive an artifact to reference-grade quality through an indefinite build/critique cycle. You (the main agent) act as the **lead** orchestrator. You do not build or critique directly; instead, you decompose the goal, fan out a builder subagent and a separate, fresh critic subagent per piece, and loop until the output beats a concrete quality bar.

**Core rule: Never let the builder grade itself.** The critic must be a fresh subagent with no exposure to the builder's reasoning or internal logs. It inspects the real rendered output, compares it blind against the reference bar, names the single largest remaining gap, and sends it back.

---

## Roles

- **Lead (You)**: Holds the goal and the quality bar, determines the decomposition, fans out subagents (`invoke_subagent`), routes feedback, and maintains the live progress page (`gauntlet-progress.html`).
- **Builder (`self` subagent)**: Produces or edits one piece. Gets the goal, the reference bar, output target path, and the critic's latest gap note (on rounds > 1). Does not touch adjacent pieces.
- **Critic (`research` subagent / fresh context)**: Fresh subagent spawned with no builder context or history. Inspects the actual rendered output alongside the bar, runs a blind A/B comparison when applicable, and returns only:
  1. Verdict (`output_wins` / `bar_wins` / `tie`)
  2. The single largest meaningful gap to close next.

---

## Workflow Steps

### 1. Lock the Reference Bar
A concrete, inspectable reference (image, URL, file, running app, benchmark).
- If provided by the user, use it.
- If not provided, propose a concrete bar before building. Name a real artifact or benchmark that a fresh critic can load and compare against.

### 2. Decompose into Judgable Pieces
Split the objective into the smallest pieces that can be independently built, judged, and improved. You (the lead agent) decide the decomposition.

### 3. Fan Out the Loop per Piece
For each piece:
1. **Builder**: Run a subagent to build or modify the piece to meet the bar.
2. **Critic**: Spawn a fresh subagent to inspect the actual rendered output against the bar.
3. **Route**: If `bar_wins` or `tie`, pass the single largest gap back to a new builder subagent. Loop until `output_wins`.

### 4. Maintain Live Progress Page
Maintain `gauntlet-progress.html` in the workspace showing each piece's round count, latest output, and verdict.

### 5. Smoothing Pass
Once all pieces beat their bars, run one fresh agent over the whole project to resolve seams, unify styles, and ensure cohesive integration.
