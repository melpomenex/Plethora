# Specification: Consolidated Learning Navigation and Workspaces

## ADDED Requirements

### Requirement: Seven-Destination Primary Learning Navigation
The application shell MUST organize primary navigation across desktop (`Toolbar.tsx`) and mobile (`MobileNavigation.tsx`) around seven cohesive learning-lifecycle destinations: `Today`, `Library`, `Learn`, `Review`, `Discover`, `Knowledge`, and `Insights`, backed by a single canonical `primaryGroup` mapping in `src/navigation/tabDestinations.ts`.

#### Scenario: Primary navigation groups all learning surfaces cleanly on desktop and mobile
- **GIVEN** a user opens Plethora on desktop or mobile
- **WHEN** the navigation shell renders
- **THEN** desktop primary navigation MUST present the 7 learning-lifecycle destinations (`Today`, `Library`, `Learn`, `Review`, `Discover`, `Knowledge`, `Insights`) with sub-destination access for grouped views (e.g., `Queue` and `Scroll Mode` under `Review`; `Smart Feeds`, `Podcasts`, `Newsletters`, and `Web Browser` under `Discover`)
- **AND** mobile navigation MUST surface primary destinations in the bottom bar and overflow sheet filtered by `getPlatformCapability` so unavailable platform capabilities are never rendered as broken primary tabs

#### Scenario: Power users can pin sub-destinations without cluttering defaults
- **GIVEN** a power user opens navigation/toolbar customization settings
- **WHEN** they pin a sub-destination (such as `Scroll Mode` or `Queue`) to the primary toolbar
- **THEN** the customization control MUST be discoverable via Settings search (`settingsSearchCatalog.ts` and `settingsSearchCoverage.ts`) and persist across restarts

---

### Requirement: Full Alias, Shortcut, Split-Pane, and Deep-Link Compatibility
Consolidating primary navigation MUST preserve 100% backward compatibility with all existing `TabType` identifiers, `TAB_TYPE_ALIASES` routes, keyboard shortcuts, command palette commands, middle-click split-pane actions, and onboarding tour anchors.

#### Scenario: Legacy routes, shortcuts, and new primary aliases all resolve deterministically
- **GIVEN** a user or test triggers navigation via `/dashboard`, `/today`, `/documents`, `/library`, `/queue`, `/scroll-mode`, `/study-plans`, `/learn`, `/rss`, `/discover`, `/knowledge-sphere`, `/knowledge`, `/analytics`, `/insights`, or `/learning-insights`
- **WHEN** `resolveTabType` and `CommandCenter` process the route or alias
- **THEN** every legacy and new primary alias MUST resolve to its declared `TabType` without error
- **AND** middle-click and split-screen commands MUST continue opening targets in split panes

---

### Requirement: Universal Study Workspace Launch from Any Activity
Any learning activity (document, extract, flashcard source, Study Plan node, guided reading trail segment, remediation task, or Unified Learning Session step) MUST launch into the single canonical reader host (`DocumentViewerWrapper.tsx` / `study-canonical-reader-host`) via `launchStudyWorkspace`, preserving mutually exclusive `"read" | "study"` modes and exact return-to-origin state restoration.

#### Scenario: Launching a Study Plan node or remediation task opens the canonical Study Workspace and restores origin
- **GIVEN** a learner is viewing a Study Plan node or remediation card linked to document `D` at passage locator `L`
- **WHEN** the learner launches the activity via `launchStudyWorkspace`
- **THEN** the single canonical `BaseDocumentViewer` inside `study-canonical-reader-host` MUST open document `D` scrolled to locator `L` in `"study"` mode without mounting a second duplicate reader instance
- **AND** selecting "Return" MUST restore the learner's exact originating tab and viewport/session state

#### Scenario: Casual library reading opens cleanly in Read Mode without forced Study chrome
- **GIVEN** a casual reader opens a document directly from `Library`
- **WHEN** `launchStudyWorkspace` runs with default `preferredMode = "read"`
- **THEN** the document MUST open in clean `"read"` mode without forcing assessments, Study Mode drawers, or AI Assistant panels

---

### Requirement: Contextual Workspace Privacy and Exam Isolation
The Universal Study Workspace and `Insights` navigation MUST enforce document privacy flags (`is_local_only`, `is_ai_excluded`), Health Vault physical isolation (`health/health.db`), and active exam isolation.

#### Scenario: Local-only document blocks cloud AI in workspace Assistant
- **GIVEN** a learner opens a document marked `is_local_only = true` or `is_ai_excluded = true` in the Study Workspace
- **WHEN** the learner toggles the `"with-assistant"` layout
- **THEN** `privacyGate.ts` MUST block any document content from being sent to cloud AI providers and display an explicit local-only/AI-excluded indicator

#### Scenario: Active isolated exam suppresses contextual Assistant spoilers
- **GIVEN** a learner is inside an active `mock_exam`, `summative_exam`, or `mastery` session (`examIsolationActive = true`)
- **WHEN** a workspace surface is displayed during the exam
- **THEN** the contextual Assistant MUST remain locked/suppressed until the exam attempt is submitted

#### Scenario: Health Vault insights remain isolated under Insights navigation
- **GIVEN** a user navigates to `Insights` and switches between Learning Analytics and Health/Sleep Learning Insights
- **WHEN** Health/Sleep Learning Insights renders from `health/health.db`
- **THEN** no raw Health Vault records MUST be exposed to learning analytics sync payloads or contextual AI Assistant prompts
