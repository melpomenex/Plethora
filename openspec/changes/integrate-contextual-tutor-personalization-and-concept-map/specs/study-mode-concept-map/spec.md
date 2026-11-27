# Study Mode Interactive Concept Map Specification

## ADDED Requirements

### Requirement: Interactive Connected Concept Map Graph
The `Explore` tab's Concept Map SHALL render an interactive node-edge graph with pan/zoom controls, directional labeled relationship edges, and keyboard-accessible node selection, replacing the static card grid.

#### Scenario: Pan, zoom, and keyboard navigation across concept nodes
- **GIVEN** a generated mind map artifact with nodes and directional edges
- **WHEN** the learner zooms in/out or selects a node via click or keyboard
- **THEN** the graph viewport updates cleanly and the selected node is highlighted along with its connected edges.

### Requirement: Honest Evidence-Based Mastery Badges on Concept Nodes
Every concept map node SHALL display its mastery state strictly from the unified learning-evidence engine (**Demonstrated understanding**, **Needs practice**, **Not assessed**) and SHALL NEVER mark a node understood merely because the source was read.

#### Scenario: Unassessed concept node displays Not Assessed
- **GIVEN** a learner has generated a concept map without completing formative checks for node "ATP Synthase"
- **WHEN** the concept map renders
- **THEN** "ATP Synthase" is badged "Not assessed" (never "Demonstrated understanding").

### Requirement: Contextual Concept Node Inspector
Selecting a concept node SHALL open a contextual inspector offering actions to jump to its source anchor, request an explanation, practice the concept, view/promote related flashcards, and inspect prerequisites.

#### Scenario: Clicking a node opens inspector with prerequisites and actions
- **GIVEN** node B has a `prerequisite` edge from node A and a source citation
- **WHEN** the learner clicks node B
- **THEN** the inspector lists node A under Prerequisites and provides working actions to jump to source anchor, explain, practice, and promote a flashcard.
