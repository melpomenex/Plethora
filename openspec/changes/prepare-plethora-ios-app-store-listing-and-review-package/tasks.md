## 1. Metadata Sheet (startable immediately)

- [ ] 1.1 Draft the ASC metadata sheet in `docs/release/app-store/metadata.md`: name, subtitle (3 candidates ranked), primary/secondary category, keywords within the character budget, promotional text, full description following the value-loop-first structure with local-first/no-account-required stated explicitly.
- [ ] 1.2 Draft subscription description copy from B's product facts (product names as configured in App Store Connect, trial terms if any) — no prices hard-coded in copy beyond what StoreKit truth supports at capture time; note that ASC price display is store-managed.
- [ ] 1.3 Prepare age-rating questionnaire answers and encryption/export-compliance answers per design §5, verified against Apple's current guidance at implementation.

## 2. URLs and Legal Package

- [ ] 2.1 Confirm/implement privacy policy URL consistent with C's final registry/docs; terms URL; support URL decision documented.
- [ ] 2.2 Cross-check listing claims against C's privacy-label mapping; record the consistency check result.

## 3. Reviewer Package

- [ ] 3.1 Write `docs/release/app-store/review-notes.md`: one-paragraph overview, 60-second reviewer path, account-optional statement, subscription behavior + Restore location, cloud-AI/BYO explanation matching C's disclosures, import capabilities list matching D's matrix.
- [ ] 3.2 Define the reviewer demo account: credentials handling via ASC review-information fields only, seeded sample library contents (small public-domain documents imported via existing tooling), and post-review deletion expectation.
- [ ] 3.3 Dry-run the reviewer path end-to-end on an RC/TestFlight build; fix notes until it completes unaided; record as evidence.

## 4. Screenshots (blocked until G's RC exists)

- [ ] 4.1 Storyboard the five frames (Read anything / Capture what matters / Remember automatically / Build your library / optional Listen-and-learn gated on G's TTS-stability evidence) with exact in-app states to reproduce.
- [ ] 4.2 Capture frames from the exact RC TestFlight build on required iPhone sizes (6.9", 6.5") and iPad 13" if supported; record build number + device per frame in the evidence chain.
- [ ] 4.3 Apply minimal caption overlays consistent with brand; no content that diverges from actual app behavior.

## 5. Final Assembly

- [ ] 5.1 Assemble `docs/release/app-store/submission-package.md`: metadata final values, screenshot set manifest, review notes, URLs, age rating, encryption answer — each item cross-referenced to its evidence or owning proposal.
- [ ] 5.2 **Documentation correction:** reconcile any stale marketing/descriptor text in repo docs with the launch positioning where trivially wrong (do not rewrite history); verify `mobile-screenshots/` provenance or mark it superseded by RC captures.
