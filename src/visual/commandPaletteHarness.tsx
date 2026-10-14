/**
 * Deterministic visual fixture for the command hub (revamp-command-palette,
 * task 10.1).
 *
 * Synthetic data only — it lives here in the harness, never in production
 * stores. Fixed data (no clock reads: relative times are literal strings), a
 * fixed font stack, and a deterministic inline-SVG cover so screenshots are
 * reproducible. The surrounding "dashboard" is a neutral backdrop: the
 * reference comparison covers the overlay chrome, not the app shell.
 *
 * `window.paletteHarness` lets the Playwright spec switch states (first-run,
 * zero-due, unavailable assistant, contextual actions, search failure) and
 * inspect what actions were dispatched.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { ThemeProvider, useTheme } from "../contexts/ThemeContext";
import { GlobalSearch, type PaletteHubController, type SearchResult } from "../components/search/GlobalSearch";
import { SearchResultType } from "../components/search/GlobalSearch";
import type { Command } from "../components/common/CommandPalette";
import { CommandCategory } from "../components/common/CommandPalette";
import type { PaletteHomeModel, PaletteSuggestion } from "../commandPalette/types";

// Fixture font contract: a fixed system sans stack, pinned with !important so
// the theme layer cannot swap it. The app itself honors theme fonts; the
// fixture pins them so geometry captures stay comparable across themes.
const FONT_PIN = document.createElement("style");
FONT_PIN.textContent =
  ':root { --font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important; --font-family-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important; }';
document.head.appendChild(FONT_PIN);

// The backdrop behind the overlay is the theme's own root background: the
// animated-theme contract paints the shell canvas behind a transparent body,
// so the fixture mirrors the app instead of forcing a neutral color.
document.body.style.margin = "0";

/** Deterministic inline SVG cover (warm columns illustration stand-in). */
const COVER_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="212" height="312" viewBox="0 0 212 312">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8a6f45"/>
        <stop offset="0.55" stop-color="#57452c"/>
        <stop offset="1" stop-color="#241d13"/>
      </linearGradient>
    </defs>
    <rect width="212" height="312" fill="url(#sky)"/>
    <g fill="#2c2418" opacity="0.92">
      <rect x="18" y="96" width="16" height="216"/>
      <rect x="44" y="82" width="16" height="230"/>
      <rect x="70" y="104" width="16" height="208"/>
      <rect x="96" y="70" width="16" height="242"/>
      <rect x="122" y="94" width="16" height="218"/>
      <rect x="148" y="110" width="16" height="202"/>
      <rect x="174" y="86" width="16" height="226"/>
    </g>
    <rect x="0" y="52" width="212" height="28" fill="#33291a"/>
    <g fill="#1d1710">
      <rect x="14" y="20" width="184" height="12"/>
      <rect x="26" y="36" width="160" height="8"/>
    </g>
  </svg>`
);

const COVER_URL = `data:image/svg+xml,${COVER_SVG}`;

const SUGGESTIONS: PaletteSuggestion[] = [
  {
    id: "suggestion.themes",
    role: "themes",
    label: "What are the main themes in my library?",
    icon: "sparkle",
    personalized: false,
  },
  {
    id: "suggestion.summary",
    role: "summary",
    label: "Summarize the key arguments in The-Doctrine-of-Fascism",
    icon: "fileText",
    documentId: "doc-fascism",
    personalized: true,
  },
  {
    id: "suggestion.related",
    role: "related",
    label: "Find related documents on totalitarianism",
    icon: "magnifyingGlass",
    query: "totalitarianism",
    personalized: true,
  },
  {
    id: "suggestion.review",
    role: "review",
    label: "What should I review today?",
    icon: "cards",
    personalized: false,
  },
];

const COMMANDS: Command[] = [
  {
    id: "nav-dashboard",
    label: "Go to Dashboard",
    description: "Open the dashboard",
    icon: null,
    category: CommandCategory.Navigation,
    action: () => {},
  } as unknown as Command,
  {
    id: "nav-documents",
    label: "Go to Documents",
    description: "Browse your library",
    icon: null,
    category: CommandCategory.Navigation,
    action: () => {},
  } as unknown as Command,
  {
    id: "theme-set-dark",
    label: "Switch to Dark Theme",
    description: "Use a dark appearance",
    icon: null,
    category: CommandCategory.Gear,
    action: () => {},
  } as unknown as Command,
];

const SEARCH_RESULTS: SearchResult[] = [
  {
    id: "doc-fascism",
    type: SearchResultType.Document,
    title: "The-Doctrine-of-Fascism",
    excerpt:
      "…the <mark>fascist</mark> state, in its deepest essence, is a moral and spiritual conception before it is a political organization.",
    score: 0.95,
    metadata: {
      documentId: "doc-fascism",
      fileType: "pdf",
      category: "Political theory",
      tags: ["history", "totalitarianism"],
      highlightQuery: "fascism",
    },
  },
  {
    id: "doc-totalitarianism",
    type: SearchResultType.Document,
    title: "Totalitarianism in the Twentieth Century",
    excerpt:
      "Regimes that fused mass mobilization with a single-party state are compared in this survey of <mark>fascism</mark> and its rivals.",
    score: 0.8,
    metadata: {
      documentId: "doc-totalitarianism",
      fileType: "epub",
      category: "History",
      highlightQuery: "fascism",
      secondaryHits: [
        {
          id: "hit-1",
          location: { kind: "pdf", pageNumber: 42, textQuote: "fascism" },
          label: "Page 42",
          excerptHtml: "…the institutional core of <mark>fascism</mark>…",
        },
        {
          id: "hit-2",
          location: { kind: "pdf", pageNumber: 88, textQuote: "fascism" },
          label: "Page 88",
          excerptHtml: "…fascism as a political religion…",
        },
      ],
    },
  },
  {
    id: "cmd-settings",
    type: SearchResultType.Command,
    title: "Go to Settings",
    excerpt: "Adjust preferences",
    score: 0.6,
    metadata: { resultKind: "command", category: "Settings" },
  },
];

interface HarnessState {
  /** false → no resume candidate (no-resume / first-run states). */
  resume: boolean;
  due: number;
  assistant: boolean;
  /** Show "Actions in this view" ahead of the quick actions. */
  contextual: boolean;
  firstUse: boolean;
  /** Loading resume enrichment (skeleton footprint). */
  resumeLoading: boolean;
  searchFails: boolean;
}

const INITIAL_STATE: HarnessState = {
  resume: true,
  due: 1,
  assistant: true,
  contextual: false,
  firstUse: false,
  resumeLoading: false,
  searchFails: false,
};

function buildHome(state: HarnessState): PaletteHomeModel {
  return {
    collectionId: "col-default",
    firstUse: state.firstUse,
    resume: state.resumeLoading
      ? { status: "loading", item: null }
      : state.resume
        ? {
            status: "ready",
            item: {
              documentId: "doc-fascism",
              title: "The-Doctrine-of-Fascism",
              fileType: "pdf",
              progressPercent: 40,
              coverUrl: COVER_URL,
              pageCount: 342,
              formatLabel: "PDF Document",
              locationLabel: "Page 137",
              // Fixed literal: no clock reads in the fixture.
              timestampLabel: "4 hours ago",
              timestampKind: "modified",
              timestampLeadKey: "lastUpdated",
              passage:
                "The fascist state, in its deepest essence, is a moral and spiritual conception before it is a political organization.",
              sourceUrl: null,
            },
          }
        : { status: "none", item: null },
    recent: state.resume
      ? {
          status: "ready",
          item: {
            documentId: "doc-totalitarianism",
            title: "Totalitarianism in the Twentieth Century",
            fileType: "epub",
            openedAt: 1_700_000_000_000,
            source: "opened",
          },
        }
      : { status: "none", item: null },
    due: { status: "ready", dueCount: state.due },
    assistant: state.assistant
      ? { available: true }
      : { available: false, unavailableReasonKey: "palette.assistant.unavailable" },
    suggestions: SUGGESTIONS,
    contextualActions: state.contextual
      ? [
          {
            view: "document-viewer",
            actionId: "doc.search",
            title: "Search in Document",
            shortcutHint: "⌘F",
          },
          {
            view: "document-viewer",
            actionId: "doc.goToPage",
            title: "Jump to Page",
          },
          {
            view: "document-viewer",
            actionId: "doc.createExtract",
            title: "Create Extract",
          },
        ]
      : [],
  };
}

function Harness() {
  const [state, setState] = useState<HarnessState>(INITIAL_STATE);
  const [searchFails, setSearchFails] = useState(false);
  const home = useMemo(() => buildHome(state), [state]);
  const { setTheme, themes } = useTheme();
  const pendingThemeRef = useRef<string | null>(null);

  const controller = useMemo<PaletteHubController>(
    () => ({
      home,
      commands: COMMANDS,
      expandedExamples: [
        {
          id: "example.themesDeep",
          role: "themes",
          label: "What ideas keep recurring across my documents?",
          icon: "sparkle",
          personalized: false,
        },
        {
          id: "example.reviewFocus",
          role: "review",
          label: "Which cards should I study first?",
          icon: "cards",
          personalized: false,
        },
      ],
      dispatch: (invocation) => {
        (window as unknown as { __paletteDispatches: unknown[] }).__paletteDispatches = [
          ...((window as unknown as { __paletteDispatches?: unknown[] }).__paletteDispatches ?? []),
          invocation,
        ];
      },
      onContextualAction: () => {},
      saveNote: async () => null,
    }),
    [home]
  );

  (window as unknown as { paletteHarness: unknown }).paletteHarness = {
    setState: (patch: Partial<HarnessState>) =>
      setState((current) => ({ ...current, ...patch })),
    setSearchFails: (fails: boolean) => setSearchFails(fails),
    /** Applies when the lazily-loaded catalog makes the id available. */
    setTheme: (themeId: string) => {
      pendingThemeRef.current = themeId;
      setTheme(themeId);
    },
  };

  useEffect(() => {
    const pending = pendingThemeRef.current;
    if (pending && themes.some((theme) => theme.id === pending)) {
      setTheme(pending);
    }
  }, [themes, setTheme]);

  const onSearch = useMemo(
    () => async (): Promise<SearchResult[]> => {
      if (searchFails) {
        throw new Error("fixture provider failure");
      }
      return SEARCH_RESULTS;
    },
    [searchFails]
  );

  return (
    <GlobalSearch
      isOpen={true}
      onOpenChange={() => {}}
      hideTrigger={true}
      onSearch={onSearch}
      onResultClick={(result) => {
        (window as unknown as { __paletteLastResult: string }).__paletteLastResult = result.id;
      }}
      controller={controller}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider defaultTheme="biolume-abyss">
    <Harness />
  </ThemeProvider>
);
