## ADDED Requirements

### Requirement: Generation failure is distinguished from missing evidence

When eligible sources were retrieved but answer generation fails, the Q&A surface SHALL state that sources were found and the AI model could not produce a usable answer. It SHALL distinguish a known output-limit failure, explicit refusal, provider failure, and unknown empty response using available metadata. It SHALL NOT present these generation failures as absent embeddings, absent library material, or successful synthesized answers. Existing retry and AI Settings navigation SHALL remain available for applicable failures. No-evidence outcomes SHALL retain the existing scope-specific behavior.

#### Scenario: Indexed sources exist but the model returns no final answer
- **WHEN** a Library-scoped request retrieves eligible indexed sources and both permitted generation attempts return empty final content
- **THEN** the failure state says that sources were found but the model returned no usable answer
- **AND** the user can retry or open the existing AI Settings
- **AND** the surface does not recommend rebuilding embeddings or claim that the library lacks relevant material

#### Scenario: Output exhaustion has an actionable explanation
- **WHEN** generation fails after output-limit exhaustion is explicitly reported
- **THEN** the failure state explains the model's output limit and points to the existing model/output configuration
- **AND** it does not describe the library index as broken

#### Scenario: Unknown empty response does not imply a specific cause
- **WHEN** empty final content has no reliable cause metadata
- **THEN** the surface describes an empty model answer without asserting output exhaustion, refusal, or an embedding fault

#### Scenario: No eligible evidence remains
- **WHEN** retrieval and authorization filtering leave no usable evidence and no grounding passage
- **THEN** generation is skipped and the existing scope-specific no-evidence outcome is used
- **AND** the UI does not claim that sources were found

### Requirement: Answer budgets follow the selected generator

Library answer generation SHALL use the selected generator's resolved output allowance and context capacity consistently for source preparation, initial generation, and correction. The full prompt, output reserve, and bounded correction overhead SHALL fit that capacity. A fixed task default SHALL NOT silently reduce an explicitly configured larger allowance when capacity permits. Configuration belonging to another enabled provider SHALL NOT determine this request's allowance. Neither correction nor transport recovery SHALL exceed the configured output ceiling.

#### Scenario: Selected cloud model permits more than the task default
- **WHEN** the selected model has a configured output allowance above the conservative task default and sufficient context capacity
- **THEN** the request can use that allowance
- **AND** source preparation reserves room for it before choosing evidence chunks

#### Scenario: Another enabled provider has a different budget
- **WHEN** the selected generator and the first enabled provider have different context or output settings
- **THEN** the question uses the selected generator's settings for both source allocation and generation

#### Scenario: Small on-device context remains bounded
- **WHEN** the selected on-device generator has a small context window
- **THEN** complete prompt content, output reserve, and correction overhead remain within that window
- **AND** recovery does not impose an unsupported fixed large output allowance

### Requirement: Library theme questions produce evidence-bounded synthesis

When retrieved evidence supports themes across multiple documents, a question about the main themes in the library SHALL be answerable through the same grounded Q&A flow. Theme claims SHALL cite validated supporting passages and preserve source navigation. The answer SHALL limit its claims to the retrieved evidence and retain applicable incomplete-index disclosure; it SHALL NOT assert exhaustive coverage or corpus-wide theme frequency from an arbitrary retrieved subset. An empty or malformed generation response SHALL NOT relax citation validation.

#### Scenario: Main themes question recovers and cites multiple documents
- **WHEN** a user asks “What are the main themes in my library?” with eligible supporting evidence from multiple indexed documents
- **AND** the initial response is empty but the single correction returns a valid cited synthesis
- **THEN** the answer is returned with validated citations to the supporting documents
- **AND** tapping each citation navigates to its stored source location
- **AND** the answer frames its synthesis as based on the retrieved sources

#### Scenario: Corrective response invents source references
- **WHEN** correction returns theme claims with source ids or quotes unsupported by the supplied evidence
- **THEN** existing citation validation rejects or removes the unsupported references
- **AND** unsupported theme claims are not presented as a supported library answer

#### Scenario: Theme question respects a restricted source set
- **WHEN** a themes question is restricted to an authorized document subset
- **THEN** initial and corrective generation use only eligible evidence from that subset
- **AND** excluded or unauthorized documents do not appear in prompts, citations, or source navigation
