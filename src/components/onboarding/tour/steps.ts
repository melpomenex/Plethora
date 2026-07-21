import { TOUR_ANCHORS, type TourAnchorId } from "./anchors";
import type { TourChapter } from "./types";

/**
 * The tour definition — seven chapters mapping to the real product loop
 * (design D9 in the change proposal).
 *
 * Anchor handling recap:
 * - Steps declare candidate lists in preference order; the resolver picks
 *   the first present-and-visible candidate. Desktop/mobile candidates are
 *   listed together so one definition serves both shells.
 * - `requiresAnchor: true` drops the step entirely when no candidate
 *   resolves (it is excluded from the displayed total).
 * - `requiresAnchor: false` (default) degrades to a centred card.
 *
 * Reader-chapter steps are marked `requiresAnchor: false` deliberately: the
 * tour must never open a document to make a point (spec: "Navigation during
 * the tour is non-destructive" and design "Open Questions" resolution). When
 * no document is open they render as centred illustrated cards.
 */
export const TOUR_CHAPTERS: TourChapter[] = [
  {
    id: "welcome",
    labelKey: "onboarding.tour.chapter.welcome",
    steps: [
      {
        id: "welcome-orientation",
        titleKey: "onboarding.tour.welcome.title",
        bodyKey: "onboarding.tour.welcome.body",
        placement: "center",
        animation: "pulse",
      },
    ],
  },
  {
    id: "bring-in",
    labelKey: "onboarding.tour.chapter.bringIn",
    steps: [
      {
        id: "import-button",
        titleKey: "onboarding.tour.import.button.title",
        bodyKey: "onboarding.tour.import.button.body",
        anchor: [TOUR_ANCHORS.documentsImportButton, TOUR_ANCHORS.navImportFile],
        placement: "auto",
        animation: "card",
        navigateToView: { kind: "event", eventName: "tour-open-tab-documents" },
      },
      {
        id: "import-url",
        titleKey: "onboarding.tour.import.url.title",
        bodyKey: "onboarding.tour.import.url.body",
        anchor: [TOUR_ANCHORS.navImportUrl, TOUR_ANCHORS.documentsImportUrl],
        placement: "auto",
        animation: "card",
        // Optional: if the import-url toolbar button is hidden on this shell,
        // we still want the step to read as a centred card.
        requiresAnchor: false,
      },
      {
        id: "documents-grid",
        titleKey: "onboarding.tour.import.grid.title",
        bodyKey: "onboarding.tour.import.grid.body",
        anchor: TOUR_ANCHORS.documentsGrid,
        placement: "auto",
        animation: "lift",
        requiresAnchor: false,
        navigateToView: { kind: "event", eventName: "tour-open-tab-documents" },
      },
    ],
  },
  {
    id: "read-extract",
    labelKey: "onboarding.tour.chapter.readExtract",
    steps: [
      {
        id: "reader-root",
        titleKey: "onboarding.tour.read.reader.title",
        bodyKey: "onboarding.tour.read.reader.body",
        anchor: TOUR_ANCHORS.readerRoot,
        placement: "auto",
        animation: "lift",
        // No document is open during a cold-start tour → render as a centred
        // illustrated card rather than opening one.
        requiresAnchor: false,
      },
      {
        id: "extract-action",
        titleKey: "onboarding.tour.read.extract.title",
        bodyKey: "onboarding.tour.read.extract.body",
        anchor: TOUR_ANCHORS.readerExtractAction,
        placement: "auto",
        animation: "lift",
        requiresAnchor: false,
      },
      {
        id: "extracts-panel",
        titleKey: "onboarding.tour.read.extracts.title",
        bodyKey: "onboarding.tour.read.extracts.body",
        anchor: TOUR_ANCHORS.readerExtractsPanel,
        placement: "auto",
        animation: "lift",
        requiresAnchor: false,
      },
    ],
  },
  {
    id: "queue",
    labelKey: "onboarding.tour.chapter.queue",
    steps: [
      {
        id: "queue-nav",
        titleKey: "onboarding.tour.queue.nav.title",
        bodyKey: "onboarding.tour.queue.nav.body",
        anchor: [TOUR_ANCHORS.navQueue, TOUR_ANCHORS.mobileNavQueue] as TourAnchorId[],
        placement: "auto",
        animation: "pulse",
        navigateToView: { kind: "event", eventName: "tour-open-tab-queue" },
      },
      {
        id: "queue-controls",
        titleKey: "onboarding.tour.queue.controls.title",
        bodyKey: "onboarding.tour.queue.controls.body",
        anchor: TOUR_ANCHORS.queueControls,
        placement: "auto",
        animation: "card",
        requiresAnchor: false,
        navigateToView: { kind: "event", eventName: "tour-open-tab-queue" },
      },
    ],
  },
  {
    id: "review",
    labelKey: "onboarding.tour.chapter.review",
    steps: [
      {
        id: "review-nav",
        titleKey: "onboarding.tour.review.nav.title",
        bodyKey: "onboarding.tour.review.nav.body",
        anchor: [TOUR_ANCHORS.navReview, TOUR_ANCHORS.mobileNavReview] as TourAnchorId[],
        placement: "auto",
        animation: "card",
        navigateToView: { kind: "event", eventName: "tour-open-tab-review" },
      },
      {
        id: "review-grading",
        titleKey: "onboarding.tour.review.grading.title",
        bodyKey: "onboarding.tour.review.grading.body",
        anchor: TOUR_ANCHORS.reviewGradingControls,
        placement: "auto",
        animation: "card",
        requiresAnchor: false,
      },
      {
        id: "review-algorithm",
        titleKey: "onboarding.tour.review.algorithm.title",
        bodyKey: "onboarding.tour.review.algorithm.body",
        anchor: TOUR_ANCHORS.reviewAlgorithmSetting,
        placement: "auto",
        animation: "card",
        requiresAnchor: false,
        navigateToView: { kind: "event", eventName: "tour-open-tab-settings" },
      },
    ],
  },
  {
    id: "knowledge",
    labelKey: "onboarding.tour.chapter.knowledge",
    steps: [
      {
        id: "analytics-nav",
        titleKey: "onboarding.tour.knowledge.analytics.title",
        bodyKey: "onboarding.tour.knowledge.analytics.body",
        anchor: TOUR_ANCHORS.navAnalytics,
        placement: "auto",
        animation: "pulse",
        navigateToView: { kind: "event", eventName: "tour-open-tab-analytics" },
      },
      {
        id: "knowledge-sphere-nav",
        titleKey: "onboarding.tour.knowledge.sphere.title",
        bodyKey: "onboarding.tour.knowledge.sphere.body",
        anchor: TOUR_ANCHORS.navKnowledgeSphere,
        placement: "auto",
        animation: "pulse",
        navigateToView: { kind: "event", eventName: "tour-open-tab-knowledge-sphere" },
      },
    ],
  },
  {
    id: "make-yours",
    labelKey: "onboarding.tour.chapter.makeYours",
    steps: [
      {
        id: "settings-nav",
        titleKey: "onboarding.tour.make.settings.title",
        bodyKey: "onboarding.tour.make.settings.body",
        anchor: [TOUR_ANCHORS.navSettings, TOUR_ANCHORS.mobileNavSettings] as TourAnchorId[],
        placement: "auto",
        animation: "card",
        navigateToView: { kind: "event", eventName: "tour-open-tab-settings" },
      },
      {
        id: "workspace-theme",
        titleKey: "onboarding.tour.make.workspace.title",
        bodyKey: "onboarding.tour.make.workspace.body",
        anchor: [TOUR_ANCHORS.workspaceSwitcher, TOUR_ANCHORS.mobileWorkspaceSwitcher] as TourAnchorId[],
        placement: "auto",
        animation: "card",
        requiresAnchor: false,
      },
    ],
  },
];
