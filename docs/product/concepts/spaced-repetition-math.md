---
id: concepts.spaced_repetition_math
title: Mathematical Foundations of Spaced Repetition
domain: concepts
status: implemented
platforms:
  - all
summary: In-depth mathematical explanation of the Ebbinghaus forgetting curve, Stability, Difficulty, Retrievability, FSRS-6, and SM-18 SInc matrices.
how_to: Review the formulas in this document to understand why specific review intervals are calculated for your cards.
why: Spaced repetition is not arbitrary magic; understanding the mathematical two-component memory model helps learners formulate better flashcards and choose retention targets.
aliases:
  - srs math
  - forgetting curve
  - stability formula
  - retrievability equation
  - fsrs math
settings:
  - scheduler.fsrs.requestRetention
actions:
  - id: settings.learning.algorithm
    label: Configure SRS Algorithm
    shortcut: Alt+,
related:
  - scheduler.fsrs
  - scheduler.sm18
  - scheduler.sm20.arena
---

# Mathematical Foundations of Spaced Repetition

## Purpose
Provides a rigorous mathematical breakdown of the memory dynamics, forgetting curves, and optimization models powering Plethora's learning engines.

## User-Facing Behavior
- Displays Stability ($S$), Difficulty ($D$), and Retrievability ($R$) statistics in card review footers and learning analytics.
- Explains why interval growth accelerates after consecutive successful recalls and slows down after memory lapses.

## Exact Behavioral Rules
1. **Memory Retrievability $R(t, S)$**:
   $$R(t, S) = \left(1 + 0.19 \times \frac{t}{S}\right)^{-0.5}$$
   Represents the probability of successful recall after elapsed time $t$ days given current memory stability $S$.
2. **Stability Increase Factor ($\text{SInc}$)**:
   Calculates how much stability multiplies upon successful retrieval. When retrievability is low (studying just before forgetting), $\text{SInc}$ is maximized (the spacing effect).
3. **Difficulty Update ($D$)**:
   Adjusts based on user grading (`Again`, `Hard`, `Good`, `Easy`), bounded between 1.0 (trivial) and 10.0 (extremely difficult).

## Rationale
Adhering to empirical mathematical memory formulations maximizes long-term retention per minute of active study time.

## Platform Behavior
- Evaluated in high-speed native Rust algorithms with identical output across platforms.
