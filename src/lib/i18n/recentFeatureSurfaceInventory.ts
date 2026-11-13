/**
 * User-facing surfaces covered by the current localization audit.
 * Paths are repository-relative so the coverage test can verify and scan them.
 */
export const RECENT_FEATURE_SURFACE_INVENTORY = [
  {
    id: "study-plans",
    directories: ["src/components/study-plans"],
    files: [
      "src/routes/study-plans.tsx",
      "src/components/tabs/TabRegistry.tsx",
      "src/components/tabs/DashboardTab.tsx",
      "src/components/Toolbar.tsx",
      "src/components/mobile/MobileNavigation.tsx",
      "src/components/review/ReviewHome.tsx",
      "src/components/viewer/selectionInteraction/selectionActionRegistry.ts",
      "src/lib/study-plans/studyErrorMessage.ts",
    ],
  },
  {
    id: "review-and-session-workflow",
    directories: [],
    files: [
      "src/routes/review.tsx",
      "src/components/review/ReviewHome.tsx",
      "src/components/review/ReviewQueueView.tsx",
      "src/components/review/ReviewCardContent.tsx",
      "src/components/learning/LearningCardsList.tsx",
      "src/components/review/SessionCustomizeModal.tsx",
    ],
  },
  {
    id: "media-compatibility-and-provider-settings",
    directories: [],
    files: [
      "src/components/viewer/MediaCompatibilityPanel.tsx",
      "src/components/settings/DocumentsSettings.tsx",
      "src/components/settings/IntegrationSettings.tsx",
    ],
  },
  {
    id: "queue-and-scroll-workflow",
    directories: [],
    files: [
      "src/routes/queue.tsx",
      "src/pages/QueueScrollPage.tsx",
      "src/components/mobile/MobileQueueView.tsx",
      "src/components/queue/QueueItemActionSheet.tsx",
      "src/components/documents/usePriorityPopup.tsx",
    ],
  },
  {
    id: "assistant-learning-actions",
    directories: [],
    files: [
      "src/components/assistant/AssistantPanel.tsx",
      "src/components/learn/LearnThisProposalSheet.tsx",
    ],
  },
  {
    id: "extract-reader-workflow",
    directories: [],
    files: ["src/components/tabs/ExtractReader.tsx"],
  },
  {
    id: "shared-context-menu",
    directories: [],
    files: ["src/components/common/ContextMenu.tsx"],
  },
] as const;

export const RECENT_FEATURE_LOCALE_CODES = ["en", "zh", "es", "de", "fr", "ja"] as const;

/**
 * Reviewed source literals that remain as data rather than displayed copy.
 * TabRegistry titles are stable English defaults stored on tabs for backwards
 * compatibility; TabBar and WorkspaceSwitcher resolve each type through
 * getTabTitleTranslationKey before displaying the title.
 */
export const RECENT_FEATURE_SOURCE_EXCEPTIONS = [
  {
    file: "src/components/tabs/TabRegistry.tsx",
    property: "title",
    reason: "Persisted tab metadata; displayed titles resolve through locale keys.",
  },
  {
    file: "src/components/settings/IntegrationSettings.tsx",
    property: "placeholder",
    value: "/path/to/cookies.txt",
    reason: "A filesystem path example; the path syntax is intentionally locale-neutral.",
  },
  {
    file: "src/components/settings/IntegrationSettings.tsx",
    property: "placeholder",
    value: "/home/user/Documents/ObsidianVault",
    reason: "A filesystem path example; the path syntax is intentionally locale-neutral.",
  },
  {
    file: "src/components/settings/IntegrationSettings.tsx",
    property: "placeholder",
    value: "Plethora",
    reason: "The product name is intentionally unchanged.",
  },
  {
    file: "src/components/settings/IntegrationSettings.tsx",
    property: "placeholder",
    value: "Plethora Assets",
    reason: "The suggested vault folder name is persisted as an integration preference.",
  },
  {
    file: "src/components/settings/IntegrationSettings.tsx",
    property: "placeholder",
    value: "Dataview",
    reason: "The Dataview plugin name is intentionally unchanged.",
  },
  {
    file: "src/components/settings/IntegrationSettings.tsx",
    property: "placeholder",
    value: "http://localhost:8765",
    reason: "A URL example; the URL syntax is intentionally locale-neutral.",
  },
  {
    file: "src/components/settings/IntegrationSettings.tsx",
    property: "placeholder",
    value: "[{\"name\": \"VISITOR_INFO1_LIVE\", \"value\": \"...\", \"domain\": \".youtube.com\"}, ...]",
    reason: "A JSON cookie example containing third-party cookie names.",
  },
  {
    file: "src/components/settings/IntegrationSettings.tsx",
    property: "placeholder",
    value: "https://transcripts.yourdomain.com",
    reason: "A URL example; the URL syntax is intentionally locale-neutral.",
  },
  {
    file: "src/components/settings/IntegrationSettings.tsx",
    property: "placeholder",
    value: "https://your-server.com/api/plethora-webhook",
    reason: "A URL example; the URL syntax is intentionally locale-neutral.",
  },
  {
    file: "src/components/settings/IntegrationSettings.tsx",
    property: "jsx-expression",
    value: "{Server URL}/api/youtube/transcript",
    reason: "A server URL template shown as a code example.",
  },
  {
    file: "src/components/settings/IntegrationSettings.tsx",
    property: "jsx-text",
    value: "TRANSCRIPT_API_KEY",
    reason: "An environment variable name shown as code.",
  },
  {
    file: "src/components/settings/IntegrationSettings.tsx",
    property: "jsx-text",
    value: "ms",
    reason: "The standard unit abbreviation for milliseconds is locale-neutral.",
  },
  {
    file: "src/components/learning/LearningCardsList.tsx",
    property: "jsx-text",
    value: "d",
    reason: "The standard unit abbreviation for days is locale-neutral.",
  },
  {
    file: "src/components/study-plans/CurriculumDraftPreview.tsx",
    property: "jsx-fallback",
    value: "missing",
    reason: "Persisted source-resolution status sentinel; display copy is selected from localized status labels.",
  },
  {
    file: "src/components/study-plans/PlanOutline.tsx",
    property: "jsx-fallback",
    value: "not-started",
    reason: "Persisted activity-state sentinel; display copy is selected from localized activity labels.",
  },
  {
    file: "src/components/study-plans/GenerationIssueList.tsx",
    property: "jsx-fallback",
    value: "root",
    reason: "JSON path root sentinel shown as a technical field path.",
  },
] as const;

export const RECENT_FEATURE_TRANSLATION_PREFIXES = [
  "studyPlans.ui.",
  "i18nAudit.ui.",
  "contextMenu.",
  "study_plan.error.",
  "study_source.error.",
  "study_generation.error.",
  "study_generation.progress.",
  "study_generation.step.",
  "study.assessment.error.",
  "study.assessment.progress.",
  "study.diagnostic.error.",
  "study.cards.error.",
  "study_grading.error.",
  "study.grading.error.",
  "study.grading.progress.",
  "study_plan.achievement.",
  "study_plan.home.reason.",
  "errors.curriculum.",
  "research.publish.",
  "research.error.",
  "research.snapshot.",
  "research.verify.",
  "mediaCompatibility.",
  "review.inlineEditor.title",
  "review.invalidOcclusionGeometry",
  "review.imageLoadFailed",
  "review.clozeRepairRequired",
  "settingsDocs.extractPriorityInheritance",
  "integrations.youtubeCookieFile",
  "integrations.selectCookieFile",
  "integrations.cookieFileFilter",
] as const;
