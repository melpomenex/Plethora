## ADDED Requirements

### Requirement: Store metadata SHALL present the verified product
The App Store name, subtitle, description, keywords, and promotional text SHALL present Plethora as a reading-and-learning system (Read → Extract → Remember → Review), SHALL state that account creation is optional, and SHALL NOT claim any capability that is not implemented and verified on iOS per the capability matrix and release evidence.

#### Scenario: Claim traceability
- **WHEN** any listing claim is reviewed
- **THEN** it resolves to a verified feature in the iOS capability matrix or a release-evidence record

### Requirement: Screenshots SHALL come from the release-candidate build
All store screenshots SHALL be captured from the exact TestFlight/release-candidate build identified by build number in the evidence chain. Mockups or staged content materially diverging from the submitted application MUST NOT be used.

#### Scenario: Screenshot provenance audit
- **WHEN** the screenshot set is reviewed before submission
- **THEN** each frame records the RC build number and capture device

### Requirement: The reviewer package SHALL enable unaided review completion
Review notes SHALL provide a short reviewer path through the core value loop (import → read → extract → review), a working demo account with a seeded sample library delivered via App Store Connect review fields, an explanation of optional cloud/AI features and subscription behavior consistent with privacy labels, and accurate import-capability information.

#### Scenario: Reviewer dry run
- **WHEN** the reviewer path is executed on the RC build using only the review notes
- **THEN** it completes without assistance and the run is recorded

### Requirement: Subscription presentation SHALL match Apple-managed billing reality
Listing copy SHALL describe subscriptions as managed by Apple, SHALL NOT hard-code promotional prices that could diverge from StoreKit-managed pricing, and SHALL accurately describe trial terms if configured.

#### Scenario: Pricing consistency
- **WHEN** subscription copy is reviewed against the configured App Store products
- **THEN** product identity, periods, and trial terms match and no conflicting price claims exist

### Requirement: Legal and support URLs SHALL be live and consistent
Privacy policy, terms, and support URLs SHALL resolve, and the privacy policy SHALL be consistent with the app's privacy manifest, disclosures, and App Store privacy labels.

#### Scenario: Privacy consistency check
- **WHEN** the privacy policy is compared with the privacy-label mapping
- **THEN** no listed data flow or purpose contradicts the shipped disclosures
