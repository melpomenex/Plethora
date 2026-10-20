import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Feed, FeedItem } from "../../../api/rss";
import type { RssUserPreferenceUpdate } from "../../../types/rssCustomization";
import {
  RSS_LIST_HOVER_DELAY_MS,
  RSSListArticleCard,
  type RSSListArticleCardProps,
} from "../RSSListArticleCard";

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const originalMatchMedia = window.matchMedia;

function setFinePointer(matches = true) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("pointer: fine") ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

const feed: Feed = {
  id: "feed-a",
  title: "Science Feed",
  description: "Science",
  link: "https://example.com",
  feedUrl: "https://example.com/rss",
  icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
  lastUpdated: "2026-10-01",
  lastFetched: "2026-10-01",
  updateInterval: 60,
  items: [],
  subscribeDate: "2026-01-01",
  unreadCount: 1,
};

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "article-a",
    feedId: "feed-a",
    title: "A measured article headline",
    description: "<p>An article excerpt with enough words to be useful.</p>",
    content: "",
    link: "https://example.com/article-a",
    pubDate: "2026-10-01T10:00:00Z",
    categories: ["science"],
    read: false,
    favorite: false,
    ...overrides,
  } as FeedItem;
}

interface FixtureSpies {
  fetch: Mock<() => void>;
  favorite: Mock<() => void>;
  external: Mock<() => void>;
  unread: Mock<() => void>;
  train: Mock<() => void>;
  tag: Mock<() => void>;
}

function sixActions(spies: FixtureSpies) {
  return (
    <>
      <button
        type="button"
        aria-label="Fetch full content"
        onClick={(e) => {
          e.stopPropagation();
          spies.fetch();
        }}
      >
        Fetch
      </button>
      <button
        type="button"
        aria-label="Add to favorites"
        aria-pressed={false}
        onClick={(e) => {
          e.stopPropagation();
          spies.favorite();
        }}
      >
        Favorite
      </button>
      <a
        href="https://example.com/article-a"
        aria-label="Open original"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          spies.external();
        }}
      >
        Original
      </a>
      <button
        type="button"
        aria-label="Mark as unread"
        onClick={(e) => {
          e.stopPropagation();
          spies.unread();
        }}
      >
        Unread
      </button>
      <button
        type="button"
        aria-label="Train intelligence"
        onClick={(e) => {
          e.stopPropagation();
          spies.train();
        }}
      >
        Train
      </button>
      <button
        type="button"
        aria-label="Tag article"
        onClick={(e) => {
          e.stopPropagation();
          spies.tag();
        }}
      >
        Tag
      </button>
    </>
  );
}

function makeSpies(): FixtureSpies {
  return {
    fetch: vi.fn(() => {}),
    favorite: vi.fn(() => {}),
    external: vi.fn(() => {}),
    unread: vi.fn(() => {}),
    train: vi.fn(() => {}),
    tag: vi.fn(() => {}),
  };
}

function cardProps(overrides: Partial<RSSListArticleCardProps> = {}): RSSListArticleCardProps {
  const spies = makeSpies();
  return {
    feed,
    item: makeItem({ read: true }),
    preferences: {},
    selected: false,
    index: 0,
    start: 0,
    isScrolling: false,
    measureElement: vi.fn(),
    actions: sixActions(spies),
    onSelect: vi.fn(),
    onContextMenu: vi.fn(),
    onMenuKeyDown: vi.fn(),
    ...overrides,
  };
}

function renderCard(
  overrides: Partial<RSSListArticleCardProps> = {},
  preferences: RssUserPreferenceUpdate = {},
) {
  const props = cardProps({ preferences, ...overrides });
  const view = render(<RSSListArticleCard {...props} />);
  const card = view.container.querySelector("[data-rss-list-card]") as HTMLElement;
  const details = view.container.querySelector(".rss-list-details") as HTMLElement;
  return { ...view, props, card, details };
}

function articleBody(card: HTMLElement): Element {
  return card.querySelector(".rss-list-source")!;
}

function detailsToggle(): HTMLElement {
  return screen.getByRole("button", {
    name: /rssReader\.(show|hide)ArticleDetails/,
  });
}

beforeEach(() => {
  setFinePointer(true);
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
});

describe("RSSListArticleCard selection and commands", () => {
  it("selects once from the title and body, never through command bubbling", () => {
    const spies = makeSpies();
    const onSelect = vi.fn();
    const { card } = renderCard({ onSelect, actions: sixActions(spies) });

    fireEvent.click(screen.getByRole("button", { name: "A measured article headline" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(feed, expect.objectContaining({ id: "article-a" }));

    fireEvent.click(articleBody(card));
    expect(onSelect).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Fetch full content" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to favorites" }));
    fireEvent.click(screen.getByRole("link", { name: "Open original" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark as unread" }));
    fireEvent.click(screen.getByRole("button", { name: "Train intelligence" }));
    fireEvent.click(screen.getByRole("button", { name: "Tag article" }));

    expect(spies.fetch).toHaveBeenCalledOnce();
    expect(spies.favorite).toHaveBeenCalledOnce();
    expect(spies.external).toHaveBeenCalledOnce();
    expect(spies.unread).toHaveBeenCalledOnce();
    expect(spies.train).toHaveBeenCalledOnce();
    expect(spies.tag).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("does not select when the gap inside the action group is clicked", () => {
    const onSelect = vi.fn();
    const { card } = renderCard({ onSelect });
    const actions = card.querySelector("[data-rss-list-actions]") as HTMLElement;
    fireEvent.click(actions);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("routes context menus and menu keys without selecting", () => {
    const onSelect = vi.fn();
    const onContextMenu = vi.fn();
    const onMenuKeyDown = vi.fn();
    const { card } = renderCard({ onSelect, onContextMenu, onMenuKeyDown });

    fireEvent.contextMenu(card);
    expect(onContextMenu).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole("button", { name: "A measured article headline" }), {
      key: "F10",
      shiftKey: true,
    });
    fireEvent.keyDown(detailsToggle(), { key: "ContextMenu" });
    expect(onMenuKeyDown).toHaveBeenCalledTimes(2);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("RSSListArticleCard disclosure input", () => {
  it("requires real fine-pointer movement and 120ms of dwell", () => {
    vi.useFakeTimers();
    const { card, details } = renderCard();

    fireEvent.pointerEnter(card, { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(RSS_LIST_HOVER_DELAY_MS + 50));
    expect(details).toHaveAttribute("hidden");

    fireEvent.pointerMove(card, { pointerType: "mouse", clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(RSS_LIST_HOVER_DELAY_MS - 1));
    expect(details).toHaveAttribute("hidden");

    act(() => vi.advanceTimersByTime(1));
    expect(details).not.toHaveAttribute("hidden");
    expect(card).toHaveAttribute("data-expanded", "true");

    fireEvent.pointerLeave(card);
    expect(details).toHaveAttribute("hidden");
    expect(card).toHaveAttribute("data-expanded", "false");
  });

  it("does not restart a pending dwell timer on repeated movement", () => {
    vi.useFakeTimers();
    const { card, details } = renderCard();

    fireEvent.pointerMove(card, { pointerType: "mouse", clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.pointerMove(card, { pointerType: "mouse", clientX: 14, clientY: 16 });
    act(() => vi.advanceTimersByTime(20));
    expect(details).not.toHaveAttribute("hidden");
  });

  it("ignores touch movement and cancels pending hover while scrolling", () => {
    vi.useFakeTimers();
    const { card, details, rerender, props } = renderCard();

    fireEvent.pointerMove(card, { pointerType: "touch", clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(RSS_LIST_HOVER_DELAY_MS + 20));
    expect(details).toHaveAttribute("hidden");

    fireEvent.pointerMove(card, { pointerType: "mouse", clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(60));
    rerender(<RSSListArticleCard {...props} isScrolling />);
    act(() => vi.advanceTimersByTime(RSS_LIST_HOVER_DELAY_MS + 20));
    expect(details).toHaveAttribute("hidden");
  });

  it("expands on keyboard focus and collapses when focus leaves", () => {
    const { details } = renderCard();
    const title = screen.getByRole("button", { name: "A measured article headline" });

    fireEvent.focus(title);
    expect(details).not.toHaveAttribute("hidden");

    fireEvent.blur(title);
    expect(details).toHaveAttribute("hidden");
  });

  it("suppresses pointer-driven focus expansion", () => {
    const { details } = renderCard();
    const title = screen.getByRole("button", { name: "A measured article headline" });

    fireEvent.pointerDown(title, { pointerType: "mouse" });
    fireEvent.focus(title);
    expect(details).toHaveAttribute("hidden");
    fireEvent.pointerUp(title, { pointerType: "mouse" });
  });

  it("keeps hover expansion through selection but not beyond pointer leave", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const { card, details } = renderCard({ onSelect });

    fireEvent.pointerMove(card, { pointerType: "mouse", clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(RSS_LIST_HOVER_DELAY_MS));
    expect(details).not.toHaveAttribute("hidden");

    fireEvent.click(screen.getByRole("button", { name: "A measured article headline" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(details).not.toHaveAttribute("hidden");

    fireEvent.pointerLeave(card);
    expect(details).toHaveAttribute("hidden");
  });

  it("supports the details toggle with touch, Escape dismissal and explicit reopen", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const { card, details } = renderCard({ onSelect });
    const toggle = detailsToggle();

    fireEvent.pointerDown(toggle, { pointerType: "touch" });
    fireEvent.click(toggle);
    fireEvent.pointerUp(toggle, { pointerType: "touch" });
    expect(details).not.toHaveAttribute("hidden");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", details.id);
    expect(card).toHaveAttribute("data-expanded", "true");
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    expect(details).toHaveAttribute("hidden");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(details).not.toHaveAttribute("hidden");
    act(() => toggle.focus());

    const escapeEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      card.dispatchEvent(escapeEvent);
    });
    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(details).toHaveAttribute("hidden");
    expect(document.activeElement).toBe(toggle);
    expect(onSelect).not.toHaveBeenCalled();

    // Tab within the still-focused card must not reopen a dismissed card.
    fireEvent.keyDown(toggle, { key: "Tab" });
    expect(details).toHaveAttribute("hidden");

    fireEvent.click(toggle);
    expect(details).not.toHaveAttribute("hidden");
  });

  it("collapses a deliberately open card when focus leaves it", () => {
    const { details } = renderCard();
    fireEvent.click(detailsToggle());
    expect(details).not.toHaveAttribute("hidden");
    const toggle = detailsToggle();
    fireEvent.blur(toggle);
    expect(details).toHaveAttribute("hidden");
  });

  it("does not claim Escape on a collapsed card", () => {
    const { card } = renderCard();
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      card.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("RSSListArticleCard preferences", () => {
  it.each([
    ["compact"],
    ["normal"],
    ["comfortable"],
  ])("maps density %s to its scoped padding contract", (density) => {
    const { card } = renderCard({}, { density });
    expect(card).toHaveAttribute("data-density", density);
    expect(card.className).toContain(`rss-list-card--${density}`);
    expect(card.className).toContain("rss-list-card");
  });

  it("maps card/list/compact presentations and thumbnail sizes", () => {
    const image = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
    const cardView = renderCard({ item: makeItem({ thumbnail: image, read: true }) }, {
      view_mode: "card",
      thumbnail_size: "small",
    });
    expect(cardView.card.querySelector(".rss-list-thumb--card-small")).toBeTruthy();
    expect(cardView.card.querySelector(".rss-list-body")).toHaveAttribute(
      "data-thumbnail",
      "beside",
    );
    cardView.unmount();

    const cardLarge = renderCard({ item: makeItem({ thumbnail: image, read: true }) }, {
      view_mode: "card",
      thumbnail_size: "large",
    });
    expect(cardLarge.card.querySelector(".rss-list-thumb--card-large")).toBeTruthy();
    expect(cardLarge.card.querySelector(".rss-list-body")).toHaveAttribute(
      "data-thumbnail",
      "above",
    );
    cardLarge.unmount();

    const listSmall = renderCard({ item: makeItem({ thumbnail: image, read: true }) }, {
      view_mode: "list",
      thumbnail_size: "small",
    });
    expect(listSmall.card.querySelector(".rss-list-thumb--list-small")).toBeTruthy();
    listSmall.unmount();

    const listLarge = renderCard({ item: makeItem({ thumbnail: image, read: true }) }, {
      view_mode: "list",
      thumbnail_size: "large",
    });
    expect(listLarge.card.querySelector(".rss-list-thumb--list-large")).toBeTruthy();
    listLarge.unmount();

    const compact = renderCard({ item: makeItem({ thumbnail: image, read: true }) }, {
      view_mode: "compact",
      thumbnail_size: "large",
    });
    expect(compact.card.querySelector(".rss-list-thumb")).toBeNull();
    expect(compact.card).toHaveAttribute("data-view-mode", "compact");
    compact.unmount();

    const hidden = renderCard({ item: makeItem({ thumbnail: image, read: true }) }, {
      show_thumbnails: false,
    });
    expect(hidden.card.querySelector(".rss-list-thumb")).toBeNull();
  });

  it("hides a broken thumbnail locally", () => {
    const { card } = renderCard({
      item: makeItem({
        thumbnail: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
        read: true,
      }),
    });
    const image = card.querySelector(".rss-list-thumb img") as HTMLImageElement;
    expect(image).toBeTruthy();
    fireEvent.error(image);
    expect(card.querySelector(".rss-list-thumb")).toBeNull();
  });

  it.each([
    ["compact", 0, "3"],
    ["normal", 3, "3"],
    ["tall", 4, "3"],
  ])("maps card height %s to %s excerpt lines", (height, lines, _ignored) => {
    const { card } = renderCard({ item: makeItem({ read: true }) }, { card_height: height });
    fireEvent.click(detailsToggle());
    const excerpt = card.querySelector(".rss-list-excerpt");
    if (lines === 0) {
      expect(excerpt).toBeNull();
    } else {
      expect(excerpt).toHaveClass(`rss-list-excerpt--${lines}`);
    }
  });

  it("uses two excerpt lines for compact view even on tall cards", () => {
    const { card } = renderCard({ item: makeItem({ read: true }) }, {
      view_mode: "compact",
      card_height: "tall",
    });
    fireEvent.click(detailsToggle());
    expect(card.querySelector(".rss-list-excerpt")).toHaveClass("rss-list-excerpt--2");
  });

  it("applies the 50/150/500-character excerpt caps", () => {
    const text = `<p>${"word ".repeat(220)}</p>`;
    for (const cap of [50, 150, 500]) {
      const view = renderCard({ item: makeItem({ description: text, read: true }) }, {
        excerpt_length: cap,
      });
      fireEvent.click(detailsToggle());
      const excerpt = view.card.querySelector(".rss-list-excerpt")!;
      expect(excerpt.textContent!.length).toBeLessThanOrEqual(cap + 3);
      expect(excerpt.textContent!.length).toBeGreaterThan(0);
      view.unmount();
    }
  });

  it("defers author to disclosure and honours date/icon/author preferences", () => {
    const item = makeItem({ author: "Jane Researcher", read: true });
    const expanded = renderCard({ item }, { show_author: true, show_date: true, show_feed_icon: true });
    expect(screen.queryByText("by Jane Researcher")).toBeNull();
    fireEvent.click(detailsToggle());
    expect(screen.getByText("by Jane Researcher")).toBeInTheDocument();
    expect(expanded.card.querySelector("time")).toBeTruthy();
    expect(expanded.card.querySelector(".rss-list-feed-icon")).toBeTruthy();
    expanded.unmount();

    const hidden = renderCard({ item }, {
      show_author: false,
      show_date: false,
      show_feed_icon: false,
    });
    fireEvent.click(detailsToggle());
    expect(screen.queryByText("by Jane Researcher")).toBeNull();
    expect(hidden.card.querySelector("time")).toBeNull();
    expect(hidden.card.querySelector(".rss-list-feed-icon")).toBeNull();
  });

  it("omits invalid dates and empty preview regions", () => {
    const { card, details } = renderCard({
      item: makeItem({ pubDate: "not-a-date", description: "", content: "", read: true }),
    });
    expect(card.querySelector("time")).toBeNull();
    fireEvent.click(detailsToggle());
    expect(details).not.toHaveAttribute("hidden");
    expect(details.querySelector(".rss-list-excerpt")).toBeNull();
    expect(details.querySelector(".rss-list-author")).toBeNull();
  });

  it("keeps long unbroken tokens in the title without dropping text", () => {
    const title = `Start ${"x".repeat(300)} End`;
    const { card } = renderCard({ item: makeItem({ title, read: true }) });
    const titleButton = screen.getByRole("button", { name: title });
    expect(titleButton).toHaveTextContent(title);
    expect(titleButton).toHaveAttribute("title", title);
    expect(card).toBeInTheDocument();
  });
});

describe("RSSListArticleCard measurement and recycling", () => {
  it("remeasures after size-affecting commits", () => {
    const measureElement = vi.fn();
    renderCard({ measureElement });
    expect(measureElement).toHaveBeenCalled();
    const before = measureElement.mock.calls.length;

    fireEvent.click(detailsToggle());
    expect(measureElement.mock.calls.length).toBeGreaterThan(before);
  });

  it("discards disclosure and pending timers on scope remount", () => {
    vi.useFakeTimers();
    const props = cardProps();
    const { rerender } = render(<RSSListArticleCard key="scope-a" {...props} />);
    const first = document.querySelector("[data-rss-list-card]") as HTMLElement;
    fireEvent.pointerMove(first, { pointerType: "mouse", clientX: 4, clientY: 4 });
    expect(first).toHaveAttribute("data-expanded", "false");

    rerender(<RSSListArticleCard key="scope-b" {...props} />);
    act(() => vi.advanceTimersByTime(RSS_LIST_HOVER_DELAY_MS + 20));
    const second = document.querySelector("[data-rss-list-card]") as HTMLElement;
    expect(second).toHaveAttribute("data-expanded", "false");
    expect(second.querySelector(".rss-list-details")).toHaveAttribute("hidden");
  });
});
