# Baseline capture — before knowledge-policy implementation

Inspected the current C1–C8 change status and source contracts on 2026-11-12. Their OpenSpec artifacts are complete. This records code/test evidence only for the limited baseline below; it is not a device acceptance result.

| Flow | Current behavior observed | Verification |
| --- | --- | --- |
| Manual creation | The create form resolves a library scope for every creation method, even though a manual method is offered; it routes to the editor after creating the draft. | `StudyPlanCreateForm.tsx`; `StudyPlanCreateForm.test.tsx` passed. |
| Rules outline | Outline creation requires source scope and has a separate no-AI coordinator. | `rulesOutline.ts`, `noAiCoordinator.ts`; both focused suites passed. |
| Mixed assessment | Existing assessment preview has source-scope aware flow; Study Plan curriculum request itself is fixed to `source-only`. | `AssessmentPreview.test.tsx` passed; `CurriculumGenerator.tsx` generation request inspected. |
| Publish | Native plan publish runs current source-ref and DAG validation, and uses expected-plan-revision CAS. Existing Rust fixture covers direct create/list/get/activity/publish/archive. | Repository/command code inspected. |
| Frontend baseline | Seven focused test files, including plan/source validation, manual outline generation, create form, persistence and assessment preview. | 44 tests passed. Command: `npm run test:run -- src/lib/study-plans/__tests__/validation.test.ts src/lib/study-plans/__tests__/sourceValidation.test.ts src/lib/study-plans/generation/__tests__/rulesOutline.test.ts src/lib/study-plans/generation/__tests__/noAiCoordinator.test.ts src/components/study-plans/__tests__/StudyPlanCreateForm.test.tsx src/components/study-plans/__tests__/studyPlanPersistence.integration.test.tsx src/components/study-plans/assessments/__tests__/AssessmentPreview.test.tsx`. |
| Native baseline | Attempted `cargo test --lib test_study_plan_commands_direct_flow -- --nocapture`. It remained queued behind an independently running `cargo check --manifest-path src-tauri/Cargo.toml --lib` holding the build lock. | Not verified; rerun when the shared Cargo build releases the lock. |
| Mobile/platform behavior | No native UI device matrix was run for this baseline. | Not verified. |

Primary implementation gaps confirmed: `StudyPlanVersion.sourceScope` is mandatory; migrations 139–143 store a non-null scope JSON; scope validation rejects empty resolved document lists; generation validates that scope before choosing behavior; generation UI hardcodes `source-only`; create form blocks AI/rules-only without selected sources. The current publisher checks grounded refs but has no persisted knowledge authority/trust discriminator.
