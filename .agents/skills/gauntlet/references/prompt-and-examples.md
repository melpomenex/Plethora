# Gauntlet Loop — Prompts, Origin, and Bar Selection

Table of contents:
- [Origin: Matt Shumer's "Claude of Duty" prompt](#origin)
- [Meta-prompt (verbatim)](#meta-prompt)
- [Choosing the bar — worked examples](#bar-examples)
- [Template subagent prompts](#subagent-prompts)

Load this file when you need the canonical source material, when the user asks where the method comes from, or when selecting a bar for a domain you have not worked in before.

---

## Origin
<a name="origin"></a>

The Gauntlet Loop generalizes the prompt that produced *Claude of Duty*, a Three.js first-person shooter. The full method is described at `https://somethingbig.ai/gauntlet-loop`. The original game prompt (verbatim) is the minimal, strongest example of the pattern — note how short it is, and how it delegates all architectural decisions to the agent:

> I want you to build a first-person shooter at the level of the most recent Call of Duty games.
>
> It should be utterly perfect, visually beautiful, with every single thing done at AAA quality—from textures to physics to anything you could think of.
>
> Fan out sub-agents and have sub-agents tackle each one individually so that the game is utterly perfect.
>
> You should /loop on each item and have a separate sub-agent check it visually to ensure it looks triple A.
>
> That separate sub-agent should be a really harsh critic, and if it doesn't look triple A, it should keep going.
>
> Don't stop until each sub-agent is utterly wowed with the quality when compared with the actual Call of Duty game.
>
> It should literally compare them side by side blind and say which one looks better. Do this in ThreeJS. /loop until it's utterly perfect. Fan out sub-agents and ultracode.

What to copy from this prompt: goal + concrete bar, delegate the decomposition, separate the critic, blind side-by-side comparison, no fixed stop point, keep it short. What to improve: specify the *single largest gap* rule (the original says "harsh critic" — modern Gauntlet adds "return the one biggest gap" to prevent wishlist thrash).

## Meta-prompt
<a name="meta-prompt"></a>

Use this verbatim meta-prompt when you need to generate a fresh, task-specific lead-agent prompt (e.g. the user wants a tailored prompt for their own harness run). Feed it to a strong model with `[GOAL]` and `[OPTIONAL REFERENCES]` filled in:

> I want to run a Gauntlet Loop for this goal:
>
> [GOAL]
>
> Possible references or quality bars:
>
> [OPTIONAL REFERENCES]
>
> Choose the strongest concrete bar that an agent can actually inspect and compare its work against. If I have not supplied one, propose a useful comp or measurement that plays the same role for this task that real Call of Duty screenshots played for Matt Shumer's Claude of Duty game (read the prompt: https://github.com/mshumer/Claude-of-Duty/blob/main/prompt.md). Explain the bar in one sentence.
>
> Then write a short prompt for Claude Code or Codex in the style of Matt's prompt (minimal is better here, we want the agent to decide the specifics!).
>
> Give the lead agent the goal and the bar, but let it choose the approach. Tell it to divide the goal into the smallest pieces that can be improved and judged independently. For each important piece, it should fan out a builder and a separate critic with fresh context.
>
> Each critic must inspect the real output, compare it directly with the bar—using a blind A/B comparison when possible—identify the biggest remaining gap, and send it back for another round. Keep looping until our output wins or I stop the run.
>
> Have the lead agent maintain a simple live progress page that shows the work evolving over time.
>
> Have it use subagents and ultracode. Do not prescribe the architecture, exact decomposition, or a fixed number of rounds. Keep the final prompt short, just like Matt's.

## Choosing the bar
<a name="bar-examples"></a>

A good bar is: **concrete, loadable by a fresh agent, and comparable on the same axis the goal cares about.**

| Domain | Bad bar (adjective) | Good bar (inspectable) |
|---|---|---|
| Game visuals | "AAA quality" | Real Call of Duty screenshots; the critic opens both and picks which looks better blind |
| Landing page | "looks premium" | A specific URL (e.g. linear.app, stripe.com) the critic opens side-by-side |
| Marketing copy | "punchy and on-brand" | Three named competitor paragraphs the critic ranks against, blind |
| Code: API design | "clean and idiomatic" | A reference repo/SDK whose public surface the critic compares structurally |
| Code: performance | "fast" | A measurable target: p99 latency under X ms on workload Y (no A/B needed — measure) |
| Research/writing | "rigorous" | A specific paper's methodology section as the structural and tone reference |

Rules of thumb:
- Prefer **pixels or running behavior** over prose for anything visual or interactive.
- Prefer a **measurable property** (latency, token count, pass rate) when one exists — then the "critic" is a benchmark, not a judgment.
- If you must use prose as the bar, **cite exact paragraphs**, not vibes.
- One bar per piece. If a piece has two independent quality axes (e.g. visual + performance), split it into two pieces with two bars.

## Subagent prompts
<a name="subagent-prompts"></a>

Keep these short — do not over-prescribe. Adapt to the task.

### Builder (round N)

> Build `[piece name]` for: `[goal]`. The quality bar is `[bar]`. Output goes at `[path]`. Do not modify files outside `[piece scope]`. `[If round > 1: The critic's previous gap note was: "[gap]". Close this gap; do not regress other aspects.]`

### Critic (fresh — no builder context)

> You are a harsh critic with fresh eyes. Load the real output at `[path]` and the bar at `[bar]`. Compare them side by side; run a blind A/B if you can (don't assume which is which). Return ONLY: (1) verdict — `bar_wins` / `output_wins` / `tie`, and (2) the single largest meaningful gap to close next. Do not return a wishlist. Do not propose redesigns. Do not modify any files.

### Smoothing pass

> Review the combined whole at `[root]` for consistency and seams across the pieces. Fix conflicts and unify style only. Do not redesign core features or re-open pieces that already beat the bar.
