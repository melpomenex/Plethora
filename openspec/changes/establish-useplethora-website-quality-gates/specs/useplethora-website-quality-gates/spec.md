## ADDED Requirements

### Requirement: Automated smoke covers commercial paths
The website CI SHALL build the Astro site and exercise primary routes (home, features, how-it-works, pricing, downloads, privacy, security, docs, changelog, support, terms) expecting success status codes and intact navigation.

#### Scenario: Pricing route
- **WHEN** the preview server is queried for `/pricing`
- **THEN** the response is 200 and contains the Free and Pro comparison structure

### Requirement: Accessibility gate
Key pages SHALL pass automated WCAG 2.2 AA checks (axe). The interactive demo SHALL be keyboard completable when implemented. `prefers-reduced-motion` SHALL disable looping mascot motion.

#### Scenario: axe on homepage
- **WHEN** axe runs on `/`
- **THEN** there are no serious or critical violations

### Requirement: Performance budgets are enforced
Homepage initial JavaScript SHALL stay within the documented byte budget and SHALL NOT eagerly include the demo chunk. CLS-sensitive media SHALL reserve dimensions.

#### Scenario: Demo code split
- **WHEN** the homepage bundle is inspected
- **THEN** the demo state-machine module is not in the critical initial graph

### Requirement: Staging cannot be indexed
When launch indexing is `noindex` or the deployment is a Vercel Preview, every HTML response SHALL include noindex instructions and robots SHALL not invite full indexing.

#### Scenario: Default preview
- **WHEN** `PUBLIC_INDEXING` is unset or `noindex`
- **THEN** `robots.txt` and/or meta robots prevent search indexing

### Requirement: Analytics are opt-in and non-extractive
Analytics SHALL be disabled in local development by default, SHALL emit only named events from the shared contract, and SHALL NOT send document contents, demo typed input, or unnecessary fingerprints.

#### Scenario: Dev server
- **WHEN** `astro dev` runs without an analytics enable flag
- **THEN** no analytics network request is sent

### Requirement: Launch blockers prevent indexed production
Indexed production configuration SHALL fail CI if required marketing screenshots are placeholders, legal entity placeholders are still null, or banned claim phrases appear in the built HTML.

#### Scenario: Index without privacy final
- **WHEN** `PUBLIC_INDEXING=index` and `privacyFinal` is false
- **THEN** the release check fails

### Requirement: Rollback is documented
Launch documentation SHALL describe how to revert to the previous Vercel production deployment without git history rewriting.

#### Scenario: Bad deploy
- **WHEN** production is broken after a website deploy
- **THEN** an operator can follow `website/docs/launch.md` to restore the prior deployment
