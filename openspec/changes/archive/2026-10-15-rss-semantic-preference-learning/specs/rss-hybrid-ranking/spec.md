## ADDED Requirements

### Requirement: Semantic transfer in ranking
Article ranking SHALL incorporate semantic similarity to the user's positive and negative preference clusters such that unseen articles substantively similar to liked content rank higher and similar-to-disliked content rank lower, including across different authors, sources, and tags.

#### Scenario: Liked topic rises
- **WHEN** the user likes several articles from topic A and unseen articles semantically in A arrive
- **THEN** those unseen articles rank higher than equivalent items in unrelated topics

#### Scenario: Disliked topic sinks
- **WHEN** the user dislikes several articles from topic B
- **THEN** unseen B-like articles rank lower without the entire source being blocked

#### Scenario: Author is not destiny
- **WHEN** the same author publishes a different topic than liked/disliked ones
- **THEN** ranking reflects semantic content, not the author alone

### Requirement: Hybrid composition and cold start
Ranking SHALL combine semantic preference with existing classifier/metadata signals, recency, implicit engagement (saved), and an exploration component; below a minimum feedback weight the semantic term SHALL be omitted (existing behavior), and a new user's feed SHALL NOT be reordered dramatically by a single interaction.

#### Scenario: Cold start unchanged
- **WHEN** total preference weight is below the threshold
- **THEN** ranking equals the pre-change behavior

#### Scenario: Saved articles boosted
- **WHEN** an article is saved/queued
- **THEN** it receives a modest implicit-engagement boost

### Requirement: Viewport stability on feedback
Providing feedback SHALL NOT visibly reshuffle the articles currently rendered; re-ranking applies to subsequently assembled lists.

#### Scenario: No active-viewport churn
- **WHEN** the user rates an article while browsing
- **THEN** the currently rendered list order does not change

### Requirement: Ranking explainability
Where semantic preference materially drove an article's placement, the UI SHALL expose a brief reason referencing the driving preference (e.g., liked-article exemplar) behind an existing affordance.

#### Scenario: Reason shown
- **WHEN** an article's semantic term is the dominant contributor to its score
- **THEN** the relevance affordance displays a human-readable reason with a liked/disliked exemplar title
