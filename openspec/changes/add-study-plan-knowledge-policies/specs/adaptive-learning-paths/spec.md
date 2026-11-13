## MODIFIED Requirements

### Requirement: Paths derive from library structure, not free-form generation

Library-backed paths SHALL derive from frozen library evidence, canonical concepts and confirmed prerequisites. Models SHALL propose bounded topics, objectives, rationales and prerequisites under the chosen policy; mixed-mode supplements SHALL be distinguished from grounded topics and unsupported material gaps. An explicitly model-only Study Plan SHALL instead support bounded unverified proposals without library access. Both paths SHALL use deterministic strict DAG ordering, stable tie-breakers and a why-here rationale for model-generated nodes; neither SHALL silently publish model-proposed relations to the global concept graph. A no-model source outline SHALL order source inventory without claiming semantic equivalence to AI generation. Existing legacy path behavior remains available.

#### Scenario: Ordering respects prerequisites
- **WHEN** a path is generated over a fixture graph where virtual memory requires memory which requires processes
- **THEN** the node order is topologically valid and reproducible across regenerations with unchanged inputs

#### Scenario: Material gaps are explicit
- **WHEN** a required concept has no covering source in the library
- **THEN** the library-backed path identifies the gap and offers to find material, and any permitted model supplement is visibly distinguished

#### Scenario: Model proposes a cycle
- **WHEN** prerequisite output creates a cycle or unknown endpoint in either generation branch
- **THEN** the invalid relation is reported and publication stays blocked until corrected
