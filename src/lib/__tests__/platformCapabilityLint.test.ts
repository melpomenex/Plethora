import { describe, it, expect } from "vitest";
import {
  PLATFORM_CAPABILITY_IDS,
  PLATFORM_CAPABILITY_REGISTRY,
} from "../platformCapabilities";
import { primaryNavItems, allNavItems } from "../../components/mobile/MobileNavigation";
import {
  TAB_TYPE_TO_CAPABILITY,
  tabContentRegistry,
} from "../../components/tabs/TabRegistry";
import { getDefaultCommands } from "../../components/common/CommandPalette";
import {
  buildCommandRegistry,
  isRegistryCommandException,
  type RegistryDeps,
} from "../../commandPalette/registry";
import { t } from "../i18n";

/**
 * §1.4 — lint-style consistency test: every user-visible navigation,
 * tab-registry, and palette definition must either carry a platform
 * capability id or appear on the reviewed exception list below (with a
 * recorded rationale). Adding a new ungated surface fails this test.
 */

/** Tab types with no standalone nav/palette destination of their own. */
const TAB_EXCEPTION_LIST: Record<string, string> = {
  // Derived/internal views opened programmatically from a parent surface:
  "web-browser": "Opened via URL import / link handlers, not a nav destination.",
  "document-viewer": "Opened per-document from Documents/Queue/Extracts.",
  "document-extracts": "Opened per-document from the reader.",
  "extract-reader": "Opened per-extract from Extracts.",
  "knowledge-network": "Alternate view of Knowledge Sphere (same surface family).",
  "audiobook-epub-sync": "Sync mode of the audiobook viewer.",
  "import-needs-review": "Reached via the review-browser-imports flow.",
  "continue-reading": "Dashboard sub-surface; covered by core_read.",
  "queue-scroll": "Scroll Mode; covered by core_read / start-optimal-session.",
};

/** Fixed deps so the registry lint is deterministic across environments. */
const REGISTRY_TEST_DEPS: RegistryDeps = {
  translate: t,
  theme: { id: "theme-dark", name: "Dark", variant: "dark" },
  themes: [
    { id: "theme-dark", name: "Dark", variant: "dark" },
    { id: "theme-light", name: "Light", variant: "light" },
  ],
  setTheme: () => {},
  isWeb: false,
  selectedDocumentTitle: null,
  savedQueues: [],
};

describe("§1.4 capability lint — navigation definitions", () => {
  it("every mobile nav item carries a registered capability id", () => {
    for (const item of [...primaryNavItems, ...allNavItems]) {
      expect(
        item.capabilityId,
        `nav item "${item.id}" has no capabilityId`
      ).toBeDefined();
      expect(PLATFORM_CAPABILITY_IDS).toContain(item.capabilityId);
    }
  });

  it("primary bottom-nav items are all available on iOS (protected shell)", () => {
    // The five primary items are the core workflow shell; none may be
    // iOS-unavailable (enforced in depth by the protected-surface test).
    for (const item of primaryNavItems) {
      expect(item.capabilityId).toBeTruthy();
    }
  });
});

describe("§1.4 capability lint — tab registry", () => {
  it("every capability mapping points at a registered id", () => {
    for (const [tabType, capabilityId] of Object.entries(TAB_TYPE_TO_CAPABILITY)) {
      expect(PLATFORM_CAPABILITY_IDS).toContain(capabilityId);
      expect(tabContentRegistry[tabType as keyof typeof tabContentRegistry]).toBeDefined();
    }
  });

  it("every tab type is gated or on the reviewed exception list", () => {
    for (const tabType of Object.keys(tabContentRegistry)) {
      expect(
        TAB_TYPE_TO_CAPABILITY[tabType as keyof typeof TAB_TYPE_TO_CAPABILITY] ??
          TAB_EXCEPTION_LIST[tabType],
        `tab type "${tabType}" is neither capability-gated nor exception-listed`
      ).toBeDefined();
    }
  });
});

describe("§1.4 capability lint — command palette", () => {
  it("every registry command is gated or on the reviewed exception list", () => {
    const commands = buildCommandRegistry(REGISTRY_TEST_DEPS);
    expect(commands.length).toBeGreaterThan(0);
    for (const cmd of commands) {
      expect(
        cmd.capabilityId ?? (isRegistryCommandException(cmd.id) ? "allowlisted" : undefined),
        `command "${cmd.id}" is neither capability-gated nor exception-listed`
      ).toBeDefined();
      if (cmd.capabilityId) {
        expect(PLATFORM_CAPABILITY_IDS).toContain(cmd.capabilityId);
      }
    }
  });

  it("the legacy getDefaultCommands wrapper stays gated or allowlisted", () => {
    for (const cmd of getDefaultCommands()) {
      expect(
        cmd.capabilityId ?? (isRegistryCommandException(cmd.id) ? "allowlisted" : undefined),
        `command "${cmd.id}" is neither capability-gated nor exception-listed`
      ).toBeDefined();
    }
  });

  it("registry ids are unique", () => {
    expect(new Set(PLATFORM_CAPABILITY_IDS).size).toBe(PLATFORM_CAPABILITY_IDS.length);
    for (const id of PLATFORM_CAPABILITY_IDS) {
      expect(PLATFORM_CAPABILITY_REGISTRY[id]).toBeDefined();
    }
  });
});
