---
name: gauntlet
description: Run a Gauntlet Loop, an iterative build-vs-critique workflow where a lead agent decomposes an objective into independently-judged pieces, and each piece loops (build, then a fresh critic, then fix the biggest gap) until it beats a concrete quality bar. Use when the user wants to push quality past "good enough" toward a reference standard, says "gauntlet", "loop until it's great", "keep iterating against [reference]", wants a builder/critic or A/B comparison loop, or asks to run the method from somethingbig.ai/gauntlet-loop. Works for code, design, writing, games, and research. Requires an agentic harness that can spawn subagents and inspect real outputs (rendered pixels, running code, files).
---

# Gauntlet Loop

Drive an artifact to reference-grade quality through an indefinite build/critique cycle. The lead agent splits the work, fans out a builder and a *separate* critic per piece, and loops each until the output defeats a concrete bar.

**Core rule: never let the builder grade itself.** The critic must be a fresh agent with no exposure to the builder's reasoning. It inspects the real rendered output, compares it blind against the bar, names the single largest remaining gap, and sends it back. The loop has no fixed round count — it runs until the output wins or the human stops it.

## Role assignments

You (the main agent) are the **lead**. You orchestrate; you do not build or critique directly.

- **Lead** — holds the goal and the bar, chooses the decomposition, fans out builders and critics, routes critic feedback back, maintains the live progress page. Does not prescribe architecture.
- **Builder** — a subagent that produces or modifies one piece. Gets the goal, the bar, and (on later rounds) the critic's gap note. Never sees other pieces' critique history.
- **Critic** — a *fresh* subagent spawned with no builder context. Inspects the actual output side-by-side with the bar, runs a blind A/B if possible, and returns only the biggest meaningful gap (or a "we beat the bar" verdict).

In this harness: builders and critics are launched via the **Agent** tool. Builders run with full tools; critics run read-only (Explore subagent_type, or general-purpose with instructions not to modify files). Each builder and each critic is a *new* Agent call — do not reuse a subagent's context across roles.

## Workflow

### 1. Lock the bar before any building

The bar is a concrete, inspectable reference — not an adjective. "Make it amazing" fails; "match this screenshot / this URL / this paragraph" works.

- If the user gave a concrete reference (image, URL, file, running app), use it.
- If not, **propose** a bar before building. Name a real artifact the critic can load and compare against, in one sentence. For visual work, prefer real screenshots or a live reference the critic can open. For text, cite specific paragraphs. For code behavior, cite a reference implementation or measurable property.
- Confirm the bar with the user if it is ambiguous or expensive. A weak bar wastes every loop.

See `references/prompt-and-examples.md` for the canonical prompt that originated this method (Matt Shumer's *Claude of Duty*), the full meta-prompt for generating lead-agent prompts, and worked examples of bar selection across domains.

### 2. Decompose — let the lead agent choose the split

Break the goal "into the smallest pieces that can be improved and judged separately." **You** decide the decomposition based on the artifact, not the user. The user gave a destination, not a route — do not ask them to define the pieces.

Record the decomposition as a todo list (TodoWrite). Each todo is one independently-judgable piece.

### 3. For each piece, run the loop

For a piece, launch **in parallel where independent**:

1. **Builder** subagent — produce/modify the piece. Prompt includes: the piece's goal, the bar, where to write output, and "do not redesign adjacent pieces."
2. **Critic** subagent (fresh, no builder context) — load the real output and the bar. Blind A/B compare when possible. Return *only*: verdict (bar wins / output wins / tie) + the single largest meaningful gap to close.

Then route: if the bar won or tied, send the gap note back to a **new** builder call for another round. Do not relay the critic's full reasoning — relay the gap. Loop.

### 4. Do not cap the rounds

Do not tell agents "do 3 rounds and stop." The loop continues per-piece until the critic returns an "output wins" verdict or the human intervenes. If a piece stalls (same gap recurs across 2–3 rounds), escalate to the user rather than silently lowering the bar.

### 5. Keep a live progress page

Maintain a simple HTML page (or markdown) at a stable path in the workspace that shows each piece's latest output, verdict, and round count. Use `assets/progress-page.html` as the starting template — copy it into the workspace and update it each round so progress is viewable from a phone without interrupting the agents.

### 6. Smoothing pass (optional, at end of a wave)

When all pieces are beating the bar, spawn one fresh agent to review the *combined* whole for consistency and seams. This agent fixes conflicts and unifies style — it does not redesign core features or re-open settled pieces.

## Hard rules

- **Separation of context.** Builder and critic are always separate Agent calls. The critic never sees the builder's transcript, plan, or self-assessment — only the real output artifact.
- **Inspect the real output.** Critics compare actual rendered pixels / running code / final text — never a builder's summary of what it "did." For visual work, the critic must open or screenshot the result.
- **One gap per round.** The critic returns the *largest* meaningful gap, not a wishlist. This keeps each builder round focused and prevents thrash.
- **No self-grading.** A builder never marks its own piece as done. Only a fresh critic's "output wins" verdict closes a piece.
- **No fixed round count.** Don't cap iterations in the prompt.
- **Stay in scope.** Builders touch only their piece. Cross-piece integration happens only in the smoothing pass.

## When the user gave you this skill as `/gauntlet <goal>`

If a goal and optional references are provided, you may proceed directly: lock/propose the bar, decompose, and start fanning out. If only `/gauntlet` is given, ask for (1) the goal and (2) any reference/bar, then proceed. Keep the orchestration tight — you are the lead, not a builder.
