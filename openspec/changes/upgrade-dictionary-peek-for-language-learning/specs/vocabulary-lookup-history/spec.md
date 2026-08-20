# Spec Delta: vocabulary-lookup-history

## MODIFIED Requirements

### Requirement: Profile-aware lookup recording

Successful language-aware lookups SHALL record profile-scoped lexical/lookup evidence through the durable lexicon while retaining the existing no-card/no-Queue-side-effect guarantee.

#### Scenario: Language Peek lookup
- **WHEN** a Spanish Language Peek resolves a word
- **THEN** the lexical entry/lookup evidence is updated once for the actual user lookup and no SRS item is created
