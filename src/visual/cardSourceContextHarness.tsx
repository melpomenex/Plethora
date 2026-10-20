/**
 * Harness for the review-card source strip (`CardSourceContext`).
 *
 * Renders the real component against deterministic source fixtures inside the
 * same padded card shell used by `ReviewCard`:
 *   - short title
 *   - the screenshot-length title from the mobile overflow report
 *   - an unbroken long title, excerpt and URL
 *   - a title with an independent page marker and external URL
 *   - a long title with no saved excerpt
 *   - a source whose document is unavailable
 *
 * `window.__TAURI_INTERNALS__` is stubbed before the component mounts so the
 * real `getCardSourceContext` path receives fixture data in a plain browser.
 * Non-loading fixtures use the real `onActivate` seam and record activations;
 * the unavailable fixture uses the default navigation path so its persistent
 * status panel can be exercised. See `card-source-context.visual.spec.ts`.
 */
import { createRoot } from "react-dom/client";
import "../index.css";
import { CardSourceContext } from "../components/review/CardSourceContext";
import type { CardSourceContext as SourceContextData } from "../api/review";
import { useSettingsStore } from "../stores/settingsStore";

interface SourceFixture {
  key: string;
  itemId: string;
  context: SourceContextData;
  defaultNavigation?: boolean;
}

const LONG_TITLE =
  "This Is Your Brain on Music: Understanding a Human Obsession";
const UNBROKEN_TITLE = `Unbroken${"x".repeat(180)}title`;
const UNBROKEN_URL = `https://example.com/${"segment".repeat(30)}`;
const UNBROKEN_EXCERPT = `A passage without spaces: ${"y".repeat(320)}`;

const fixtures: SourceFixture[] = [
  {
    key: "short",
    itemId: "source-short",
    context: {
      document_id: "doc-short",
      document_title: "Memory Systems",
      extract_id: "ext-short",
      extract_snippet: "The hippocampus helps stabilize memories.",
      page_number: 4,
    },
  },
  {
    key: "screenshot",
    itemId: "source-screenshot",
    context: {
      document_id: "doc-screenshot",
      document_title: LONG_TITLE,
      extract_id: "ext-screenshot",
      extract_snippet:
        "Music listening engages nearly every region of the brain, including systems usually associated with emotion, memory and motor control.",
      page_number: 12,
      source_url: "https://example.com/books/this-is-your-brain-on-music",
    },
  },
  {
    key: "unbroken",
    itemId: "source-unbroken",
    context: {
      document_id: "doc-unbroken",
      document_title: UNBROKEN_TITLE,
      extract_id: "ext-unbroken",
      extract_snippet: UNBROKEN_EXCERPT,
      page_number: 88,
      source_url: UNBROKEN_URL,
    },
  },
  {
    key: "page-url",
    itemId: "source-page-url",
    context: {
      document_id: "doc-page-url",
      document_title: "A Field Guide to the Deep Sea: Creatures of the Midnight Zone",
      page_number: 42,
      source_url: "https://example.com/field-guide/deep-sea",
    },
  },
  {
    key: "no-snippet",
    itemId: "source-no-snippet",
    context: {
      document_id: "doc-no-snippet",
      document_title: LONG_TITLE,
    },
  },
  {
    key: "unavailable",
    itemId: "source-unavailable",
    context: {
      document_id: "doc-unavailable",
      document_title: "Removed Source Document",
      extract_id: "ext-unavailable",
      extract_snippet: "The excerpt survives even though the document is gone.",
      page_number: 9,
    },
    defaultNavigation: true,
  },
];

const fixtureByItemId = new Map(fixtures.map((fixture) => [fixture.itemId, fixture]));
const harnessState = {
  activations: [] as string[],
  invokes: [] as string[],
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
    cardSourceHarness?: {
      activations: string[];
      invokes: string[];
      fixtureKeys: string[];
      reset: () => void;
    };
  }
}

window.__TAURI_INTERNALS__ = {
  invoke: async (command, args) => {
    harnessState.invokes.push(command);
    if (command === "get_card_source_context") {
      const itemId = String(args?.itemId ?? args?.item_id ?? "");
      return fixtureByItemId.get(itemId)?.context ?? null;
    }
    // The unavailable fixture exercises the default path: a missing learning
    // item sets the persistent unavailable notice without opening anything.
    if (command === "get_learning_item") return null;
    if (command === "wait_for_backend_ready") return null;
    return null;
  },
};

window.cardSourceHarness = {
  get activations() {
    return harnessState.activations;
  },
  get invokes() {
    return harnessState.invokes;
  },
  fixtureKeys: fixtures.map((fixture) => fixture.key),
  reset: () => {
    harnessState.activations.length = 0;
    harnessState.invokes.length = 0;
  },
};

// Mirror the app's default system font (ThemeContext normally owns this
// variable). Without it the harness falls back to the browser serif font and
// text measurements no longer resemble the product.
document.documentElement.style.setProperty(
  "--font-family",
  'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
);
document.documentElement.style.setProperty(
  "--font-family-sans",
  'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
);

useSettingsStore.setState((state) => ({
  settings: {
    ...state.settings,
    general: {
      ...state.settings.general,
      language: "en",
    },
    learning: {
      ...state.settings.learning,
      showSourceContext: true,
    },
  },
}));

function Harness() {
  return (
    <div className="min-h-dvh bg-background p-4 text-foreground">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        {fixtures.map((fixture) => (
          <article
            key={fixture.key}
            data-fixture={fixture.key}
            className="w-full min-w-0 max-w-2xl mx-auto px-2 md:px-0"
          >
            <div
              data-review-card-body
              className="min-w-0 max-w-full rounded-lg border border-border bg-card p-6 shadow-sm"
            >
              <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
                Fixture: {fixture.key}
              </p>
              <CardSourceContext
                itemId={fixture.itemId}
                {...(fixture.defaultNavigation
                  ? {}
                  : {
                      onActivate: (itemId: string) => {
                        harnessState.activations.push(itemId);
                      },
                    })}
              />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
