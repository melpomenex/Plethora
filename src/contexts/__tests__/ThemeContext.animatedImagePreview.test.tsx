import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "../ThemeContext";
import type { Theme, ThemeContextValue } from "../../types/theme";
import type { PreparedAnimatedImage } from "../../themes/animatedImage/contracts";
import { milkyMatchaTheme, obsidianNoirTheme } from "../../themes/fallback";

const { mockCommitAnimatedImageTheme, mockCommitImportedTheme } = vi.hoisted(() => ({
  mockCommitAnimatedImageTheme: vi.fn(),
  mockCommitImportedTheme: vi.fn(),
}));

vi.mock("../../themes/animatedImage/themeMutations", () => ({
  commitAnimatedImageTheme: mockCommitAnimatedImageTheme,
  commitImportedTheme: mockCommitImportedTheme,
  recoverImageThemeMutationJournal: vi.fn(() => Promise.resolve()),
  removeAnimatedImageTheme: vi.fn(),
  selectAnimatedImageTheme: vi.fn(),
  updateAnimatedImageTheme: vi.fn(),
}));

const REGISTRY_KEY = "plethora-custom-themes";
const SELECTION_KEY = "plethora-last-theme";

function createPrepared(mediaId: string): PreparedAnimatedImage {
  const poster = new Blob(["draft"], { type: "image/png" });
  return {
    mediaId,
    tier: "desktop",
    outcome: "still",
    poster,
    thumbnail: poster,
    thumbnailDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    width: 1,
    height: 1,
    sourceWidth: 1,
    sourceHeight: 1,
    paletteSamples: [],
    stillReason: "decoder-unavailable",
  };
}

function CaptureThemeContext({ capture }: { capture: (value: ThemeContextValue) => void }) {
  capture(useTheme());
  return null;
}

describe("ThemeContext animated image drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    mockCommitAnimatedImageTheme.mockReset();
    mockCommitImportedTheme.mockReset();
  });

  it("replaces draft ownership, rejects stale generations and cancels without persisting", () => {
    let context!: ThemeContextValue;
    render(
      <ThemeProvider defaultTheme={obsidianNoirTheme.id}>
        <CaptureThemeContext capture={(value) => { context = value; }} />
      </ThemeProvider>,
    );
    const committedId = context.theme.id;
    const selectedBefore = localStorage.getItem(SELECTION_KEY);
    const registryBefore = localStorage.getItem(REGISTRY_KEY);
    const firstTheme = { ...context.theme, id: "draft-first", name: "First draft" };
    const secondTheme = { ...context.theme, id: "draft-second", name: "Second draft" };
    let firstToken = 0;
    let secondToken = 0;

    act(() => {
      firstToken = context.beginAnimatedImagePreview!(createPrepared("anim-first-00000000"), firstTheme);
      secondToken = context.beginAnimatedImagePreview!(createPrepared("anim-second-0000000"), secondTheme);
    });

    expect(context.animatedImagePreview?.token).toBe(secondToken);
    expect(context.appliedTheme.id).toBe(secondTheme.id);
    expect(context.theme.id).toBe(committedId);
    expect(context.updateAnimatedImagePreview!(firstToken, firstTheme)).toBe(false);
    act(() => context.cancelAnimatedImagePreview!(firstToken));
    expect(context.animatedImagePreview?.token).toBe(secondToken);

    act(() => context.cancelAnimatedImagePreview!(secondToken));
    expect(context.animatedImagePreview).toBeNull();
    expect(context.appliedTheme.id).toBe(committedId);
    expect(localStorage.getItem(SELECTION_KEY)).toBe(selectedBefore);
    expect(localStorage.getItem(REGISTRY_KEY)).toBe(registryBefore);
  });

  it("restores the saved applied media theme and protects surfaces by default", async () => {
    const savedTheme: Theme = {
      ...milkyMatchaTheme,
      id: "saved-media-theme",
      name: "Saved media theme",
      effects: {
        backgroundImage: {
          imageId: "media:v1:anim-saved-media-00000000:poster",
          thumbnailDataUrl: "data:image/png;base64,thumbnail",
        },
        imageAnimation: {
          version: 1,
          mediaId: "anim-saved-media-00000000",
          sourceFormat: "gif",
          enabled: true,
        },
      },
    };
    localStorage.setItem(REGISTRY_KEY, JSON.stringify([savedTheme]));
    localStorage.setItem(SELECTION_KEY, savedTheme.id);
    let context!: ThemeContextValue;

    render(
      <ThemeProvider>
        <CaptureThemeContext capture={(value) => { context = value; }} />
      </ThemeProvider>,
    );

    expect(context.theme.id).toBe(savedTheme.id);
    expect(context.appliedTheme.id).toBe(savedTheme.id);
    expect(localStorage.getItem(SELECTION_KEY)).toBe(savedTheme.id);
    await waitFor(() => expect(document.documentElement.dataset.themeImageProtected).toBe("true"));
  });

  it("exports animated themes as colors only and imports without acquiring their local media", async () => {
    const savedTheme: Theme = {
      ...milkyMatchaTheme,
      id: "shared-import-id",
      name: "Saved media theme",
      effects: {
        backgroundImage: {
          imageId: "media:v1:anim-saved-media-00000000:poster",
          thumbnailDataUrl: "data:image/png;base64,iVBORw0KGgo=",
          protectedSurfaces: true,
        },
        imageAnimation: {
          version: 1,
          mediaId: "anim-saved-media-00000000",
          sourceFormat: "gif",
          enabled: true,
        },
      },
    };
    localStorage.setItem(REGISTRY_KEY, JSON.stringify([savedTheme]));
    localStorage.setItem(SELECTION_KEY, savedTheme.id);
    let context!: ThemeContextValue;
    render(
      <ThemeProvider>
        <CaptureThemeContext capture={(value) => { context = value; }} />
      </ThemeProvider>,
    );

    const exported = JSON.parse(context.exportTheme(savedTheme.id));
    expect(exported.plethoraExport).toEqual({ version: 1, background: "colors-only" });
    expect(JSON.stringify(exported)).not.toContain("anim-saved-media-00000000");

    const importedJson = {
      ...savedTheme,
      name: "Imported copy",
      effects: {
        ...savedTheme.effects,
        backgroundImage: {
          ...savedTheme.effects?.backgroundImage,
          imageId: "media:v1:anim-saved-media-00000000:poster",
        },
      },
      plethoraExport: { version: 1, background: "colors-only" },
    };
    mockCommitImportedTheme.mockImplementationOnce(async (theme: Theme) => ({
      customThemes: [savedTheme, theme],
      selectedThemeId: theme.id,
    }));
    let importedTheme!: Theme;
    await act(async () => {
      importedTheme = await context.importTheme(JSON.stringify(importedJson));
    });

    expect(importedTheme.id).not.toBe(savedTheme.id);
    expect(importedTheme.effects?.imageAnimation).toBeUndefined();
    expect(importedTheme.effects?.backgroundImage).toEqual({
      imageId: "",
      thumbnailDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    });
    expect(mockCommitImportedTheme).toHaveBeenCalledTimes(1);
    expect(context.theme.id).toBe(importedTheme.id);
  });

  it("keeps the normal theme picker preview and refreshes when another tab changes storage", async () => {
    let context!: ThemeContextValue;
    render(
      <ThemeProvider defaultTheme={obsidianNoirTheme.id}>
        <CaptureThemeContext capture={(value) => { context = value; }} />
      </ThemeProvider>,
    );
    const selectedBefore = localStorage.getItem(SELECTION_KEY);

    act(() => context.previewTheme(milkyMatchaTheme.id));
    expect(context.appliedTheme.id).toBe(milkyMatchaTheme.id);
    expect(context.theme.id).toBe(obsidianNoirTheme.id);
    expect(localStorage.getItem(SELECTION_KEY)).toBe(selectedBefore);
    act(() => context.previewTheme(null));
    expect(context.appliedTheme.id).toBe(obsidianNoirTheme.id);

    const importedTheme: Theme = { ...milkyMatchaTheme, id: "cross-tab-theme", name: "Cross tab" };
    localStorage.setItem(REGISTRY_KEY, JSON.stringify([importedTheme]));
    localStorage.setItem(SELECTION_KEY, importedTheme.id);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: REGISTRY_KEY }));
      window.dispatchEvent(new StorageEvent("storage", { key: SELECTION_KEY }));
    });

    await waitFor(() => {
      expect(context.themes.some((theme) => theme.id === importedTheme.id)).toBe(true);
      expect(context.theme.id).toBe(importedTheme.id);
    });
  });

  it("rejects a second save while the token owner is committing", async () => {
    let context!: ThemeContextValue;
    render(
      <ThemeProvider defaultTheme={obsidianNoirTheme.id}>
        <CaptureThemeContext capture={(value) => { context = value; }} />
      </ThemeProvider>,
    );
    const draftTheme: Theme = {
      ...context.theme,
      id: "draft-save",
      name: "Draft save",
      effects: {
        backgroundImage: {
          imageId: "media:v1:anim-draft-save-00000000:poster",
          protectedSurfaces: true,
        },
      },
    };
    let finishCommit!: (result: { customThemes: Theme[]; selectedThemeId: string }) => void;
    mockCommitAnimatedImageTheme.mockReturnValueOnce(new Promise((resolve) => {
      finishCommit = resolve;
    }));
    let token = 0;
    act(() => {
      token = context.beginAnimatedImagePreview!(createPrepared("anim-draft-save-00000000"), draftTheme);
    });

    const firstSave = context.commitAnimatedImagePreview!(token);
    const duplicateSave = context.commitAnimatedImagePreview!(token);
    await expect(duplicateSave).rejects.toMatchObject({ code: "storage-write-failed" });
    expect(mockCommitAnimatedImageTheme).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishCommit({ customThemes: [draftTheme], selectedThemeId: draftTheme.id });
      await firstSave;
    });
    expect(context.theme.id).toBe(draftTheme.id);
    expect(context.animatedImagePreview).toBeNull();
  });
});
