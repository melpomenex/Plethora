## ADDED Requirements

### Requirement: Deterministic HTML fixture corpus
The extraction pipeline SHALL be covered by a static fixture corpus under the article-import test directory, with each fixture pairing a `page.html` input and an `expected.json` assertion file, covering at least: traditional news, WordPress news, a Mother Jones-style page, Substack, Medium-style, Wikipedia, a blog, a documentation page, heavy navigation, repeated recommendation blocks, newsletter CTAs, donation prompts, embedded modal markup, multi-image articles, figure captions, tables, blockquotes, code, lazy-loaded images, relative image URLs, malformed HTML, a JavaScript-rendered shell, JSON-LD metadata, a page where Defuddle wins, a page where Readability wins, and a page where both static candidates fail and rendered extraction is required.

#### Scenario: Fixture categories exist
- **WHEN** the regression suite runs in CI
- **THEN** every listed corpus category has a fixture that executes the real pipeline against static HTML

### Requirement: Assertions prove extraction quality, not mere output
Each fixture's assertions SHALL cover expected title, author, publication date where determinable, required article paragraphs/minimum word count, figures/captions/URL expectations, absence of navigation, footer, subscribe/donation/related-content/modal text, expected winning extractor where deterministic, and expected confidence range — not merely that some output was produced.

#### Scenario: Chrome text absence asserted
- **WHEN** a chrome-heavy fixture is run
- **THEN** the suite fails if nav/footer/subscribe/donation strings appear in the extracted text

#### Scenario: Winning extractor asserted where deterministic
- **WHEN** a fixture is designed so one engine reliably outperforms the other
- **THEN** the suite asserts that engine wins and its confidence falls in the expected range

### Requirement: Mother Jones regression case
The reported Mother Jones failure SHALL be captured as an explicit regression fixture asserting the publication "Mother Jones", the title "The Trumps' Crypto Project Just Got One Step Closer to Becoming a Bank", author "Sophie Hurwitz", date "August 15, 2026", presence of the hero figure/caption, article-bounded content, and the absence of the reported chrome strings ("Skip to main content", "Share on Facebook", "Donate", "Subscribe", "Related", "We Recommend", "Latest", "Sign up for our free newsletter", "Get our award-winning magazine", "Privacy Manager", "We see you're using an ad blocker", "One quick request..."); these strings are fixture assertions only and SHALL NOT be hardcoded as scorer special cases.

#### Scenario: Mother Jones fixture passes generically
- **WHEN** the Mother Jones regression fixture runs
- **THEN** metadata and body assertions pass via the generic pipeline with no site-specific rule registered

### Requirement: CI hermeticity
The regression suite SHALL NOT depend on live publisher websites or network access for ordinary CI runs; fetches are fulfilled from fixtures, and the rendered-capture clients are exercised through injected fakes; real capture paths are validated by the manual platform matrix.

#### Scenario: Suite runs offline
- **WHEN** the unit/regression suite runs with no network
- **THEN** all fixture-based tests pass

### Requirement: Benchmark and bundle-budget integration
The article pipeline SHALL be covered by a repository-convention benchmark (`src/**/*.bench.ts`, seeded PRNG inputs, results consumed), and the bundle impact of new extraction dependencies SHALL be measured and recorded by updating `scripts/bundle-budgets.json` (and perf baselines when applicable) in the same change with a justification, per the repo's performance gate protocol.

#### Scenario: Bench gate covers the pipeline
- **WHEN** `npm run bench:check` runs
- **THEN** an article-import benchmark executes and is compared against recorded baselines

#### Scenario: Bundle budget updated with the change
- **WHEN** the change adds Defuddle/Readability/DOMPurify usage to the bundle
- **THEN** the bundle budget file is updated in the same change with a justification comment
