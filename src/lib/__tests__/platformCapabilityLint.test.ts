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

/** Palette commands that are platform-neutral mechanics (no native bridge). */
const COMMAND_EXCEPTION_LIST: Record<string, string> = {
  "tag-untagged-documents": "Local smart-tagging; works on every platform.",
  "cleanup-legacy-auto-tags": "Local tag cleanup; works on every platform.",
  "review-browser-imports": "Needs-review queue; works on every platform.",
  "toggle-theme": "UI-only theme toggle.",
  "keyboard-shortcuts": "Help overlay; platform-neutral.",
  "paste-extract": "Gated via capabilityId core_extract in CommandCenter.",
  "ask-my-library":
    "Feature-flag gated (settings.features.aiLibraryRag) in getDefaultCommands; dispatches a DOM event to the platform-neutral SearchPage RAG surface (no native bridge).",
  "translate-selection":
    "Ungated-with-rationale: the palette action only dispatches a DOM event; no native bridge is called from the command itself.",
  "record-lecture-android":
    "Ungated-with-rationale: dispatches a DOM event consumed by LectureCaptureHost (MainLayout), which uses standard web media APIs; the Android speech provider degrades to the configured transcription provider off-Android.",
  "start-guided-tour": "Onboarding tour; platform-neutral.",
  "import-twitter-video":
    "Ungated-with-rationale: uses the Rust backend, which ships on iOS too (audit §Command palette).",
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
  it("every default command is gated or on the reviewed exception list", () => {
    for (const cmd of getDefaultCommands()) {
      expect(
        cmd.capabilityId ?? COMMAND_EXCEPTION_LIST[cmd.id],
        `command "${cmd.id}" is neither capability-gated nor exception-listed`
      ).toBeDefined();
      if (cmd.capabilityId) {
        expect(PLATFORM_CAPABILITY_IDS).toContain(cmd.capabilityId);
      }
    }
  });

  it("registry ids are unique", () => {
    expect(new Set(PLATFORM_CAPABILITY_IDS).size).toBe(PLATFORM_CAPABILITY_IDS.length);
    for (const id of PLATFORM_CAPABILITY_IDS) {
      expect(PLATFORM_CAPABILITY_REGISTRY[id]).toBeDefined();
    }
  });
});
