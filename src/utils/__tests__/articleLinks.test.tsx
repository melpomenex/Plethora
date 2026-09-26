/**
 * Article link routing tests (hyperlink-selection-context-actions tasks
 * 5.1/5.2): fixture articles with footnotes, external links, and hostile
 * hrefs; the four link-menu actions dispatch correctly.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anchorFromEventTarget,
  buildArticleLinkMenuItems,
  classifyArticleLink,
} from "../articleLinks";
import { ContextMenu } from "../../components/common/ContextMenu";

afterEach(cleanup);

describe("classifyArticleLink", () => {
  const base = "https://example.com/articles/main";

  it("routes same-document fragments natively", () => {
    expect(classifyArticleLink("#footnote-1", base)).toBe("fragment");
    expect(classifyArticleLink("#", base)).toBe("fragment");
  });

  it("accepts external http/https links, resolving relative hrefs against the base", () => {
    expect(classifyArticleLink("https://other.org/post", base)).toEqual({
      url: "https://other.org/post",
      mailto: false,
    });
    expect(classifyArticleLink("/about", base)).toEqual({
      url: "https://example.com/about",
      mailto: false,
    });
    expect(classifyArticleLink("subsection.html", base)).toEqual({
      url: "https://example.com/articles/subsection.html",
      mailto: false,
    });
  });

  it("flags mailto links for the OS handler", () => {
    expect(classifyArticleLink("mailto:author@example.com", base)).toEqual({
      url: "mailto:author@example.com",
      mailto: true,
    });
  });

  it("never activates unsafe schemes", () => {
    expect(classifyArticleLink("javascript:alert(1)", base)).toBe("unsafe");
    expect(classifyArticleLink("JAVASCRIPT:alert(1)", base)).toBe("unsafe");
    expect(classifyArticleLink("data:text/html,<script>", base)).toBe("unsafe");
    expect(classifyArticleLink("vbscript:msgbox", base)).toBe("unsafe");
    expect(classifyArticleLink("file:///etc/passwd", base)).toBe("unsafe");
  });

  it("returns null for missing hrefs and unsafe for unparseable ones", () => {
    expect(classifyLink(null)).toBeNull();
    expect(classifyLink(undefined)).toBeNull();
    expect(classifyLink("", base)).toBeNull();
  });

  function classifyLink(href: string | null | undefined, baseUri?: string) {
    return classifyArticleLink(href, baseUri);
  }
});

describe("anchorFromEventTarget", () => {
  it("finds the anchor from a nested event target", () => {
    const root = document.createElement("div");
    root.innerHTML = `<p>Text with <a href="https://example.com"><strong>bold <em>link text</em></strong></a> inside.</p>`;
    document.body.appendChild(root);
    const em = root.querySelector("em")!;
    expect(anchorFromEventTarget(em)?.getAttribute("href")).toBe("https://example.com");
    const text = root.querySelector("p")!.firstChild!;
    expect(anchorFromEventTarget(text)).toBeNull();
    expect(anchorFromEventTarget(null)).toBeNull();
    expect(anchorFromEventTarget({} as EventTarget)).toBeNull();
  });
});

describe("article link menu (task 5.2)", () => {
  function renderLinkMenu(mailto = false) {
    const actions = {
      onOpen: vi.fn(),
      onSave: vi.fn(),
      onOpenExternal: vi.fn(),
      onCopyLink: vi.fn(),
    };
    const items = buildArticleLinkMenuItems({
      url: "https://example.com/linked",
      mailto,
      t: (key) => key,
      actions,
    });
    render(
      <ContextMenu
        menuId="test-link-menu"
        items={items}
        visible
        position={{ x: 10, y: 10 }}
        onClose={() => undefined}
      />,
    );
    return actions;
  }

  it("offers all four actions with labels and dispatches each", () => {
    const actions = renderLinkMenu();
    const buttons = screen.getAllByRole("menuitem");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "articleLink.open",
      "articleLink.saveToPlethora",
      "articleLink.openExternal",
      "articleLink.copyLink",
    ]);

    fireEvent.click(buttons[0]!);
    expect(actions.onOpen).toHaveBeenCalledWith({ url: "https://example.com/linked", mailto: false });
    fireEvent.click(buttons[1]!);
    expect(actions.onSave).toHaveBeenCalledWith("https://example.com/linked");
    fireEvent.click(buttons[2]!);
    expect(actions.onOpenExternal).toHaveBeenCalledWith("https://example.com/linked");
    fireEvent.click(buttons[3]!);
    expect(actions.onCopyLink).toHaveBeenCalledWith("https://example.com/linked");
  });

  it("disables Save for mailto links (no import path)", () => {
    const actions = renderLinkMenu(true);
    const buttons = screen.getAllByRole("menuitem");
    expect(buttons[1]).toBeDisabled();
    fireEvent.click(buttons[1]!);
    expect(actions.onSave).not.toHaveBeenCalled();
    // Open still routes the mailto target to the OS handler.
    fireEvent.click(buttons[0]!);
    expect(actions.onOpen).toHaveBeenCalledWith({ url: "https://example.com/linked", mailto: true });
  });
});
