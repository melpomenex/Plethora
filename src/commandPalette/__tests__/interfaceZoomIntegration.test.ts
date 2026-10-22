import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("../../lib/interfaceZoom/native", () => ({
  isDesktopInterfaceZoomSupported: () => true,
  applyNativeInterfaceZoom: async () => {},
}));

import { buildCommandRegistry, matchCommands, type RegistryDeps } from "../registry";
import { actionMatchesQuery, getActionsForView } from "../contextualActions";
import { en } from "../../lib/i18n/locales/en";

function deps(): RegistryDeps {
  return {
    translate: (key) => en[key] ?? key,
    theme: { id: "theme-dark", name: "Dark", variant: "dark" },
    themes: [
      { id: "theme-dark", name: "Dark", variant: "dark" },
      { id: "theme-light", name: "Light", variant: "light" },
    ],
    setTheme: vi.fn(),
    isWeb: false,
    selectedDocumentTitle: "Test document",
    savedQueues: [],
  };
}

describe("interface zoom and document zoom in the palette", () => {
  it("returns both families for a zoom query in a document-viewer context", () => {
    const appCommands = matchCommands(buildCommandRegistry(deps()), "zoom").map(
      (match) => match.command,
    );
    const documentActions = getActionsForView("document-viewer", { viewerKind: "pdf" }).filter(
      (action) => actionMatchesQuery(action, "zoom"),
    );

    const appIds = appCommands.map((command) => command.id);
    expect(appIds).toEqual(
      expect.arrayContaining(["interface-zoom-in", "interface-zoom-out", "interface-zoom-reset"]),
    );

    const docIds = documentActions.map((action) => action.id);
    expect(docIds).toEqual(
      expect.arrayContaining(["doc.zoomIn", "doc.zoomOut", "doc.zoomReset"]),
    );
  });

  it("uses distinct names for application and document zoom", () => {
    const appCommands = matchCommands(buildCommandRegistry(deps()), "zoom").map(
      (match) => match.command,
    );
    const byId = new Map(appCommands.map((command) => [command.id, command]));
    const actions = new Map(
      getActionsForView("document-viewer", { viewerKind: "pdf" }).map((action) => [
        action.id,
        action,
      ]),
    );

    expect(byId.get("interface-zoom-in")?.label).toBe("Zoom In");
    expect(byId.get("interface-zoom-out")?.label).toBe("Zoom Out");
    expect(byId.get("interface-zoom-reset")?.label).toBe("Reset Zoom");
    expect(actions.get("doc.zoomIn")?.title).toBe("Zoom Document In");
    expect(actions.get("doc.zoomOut")?.title).toBe("Zoom Document Out");
    expect(actions.get("doc.zoomReset")?.title).toBe("Reset Document Zoom");

    const labels = [
      byId.get("interface-zoom-in")?.label,
      byId.get("interface-zoom-out")?.label,
      byId.get("interface-zoom-reset")?.label,
      actions.get("doc.zoomIn")?.title,
      actions.get("doc.zoomOut")?.title,
      actions.get("doc.zoomReset")?.title,
    ];
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("keeps the document action ids routed through DocumentViewer", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../components/viewer/DocumentViewer.tsx"),
      "utf8",
    );
    expect(source).toContain('"doc.zoomIn": () => handleZoomIn()');
    expect(source).toContain('"doc.zoomOut": () => handleZoomOut()');
    expect(source).toContain('"doc.zoomReset": () => handleResetZoom()');
  });
});
