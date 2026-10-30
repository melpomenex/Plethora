/**
 * Settings search catalog (change: improve-settings-search).
 *
 * A component-free, static inventory of the settings and configuration groups
 * that are reachable in the Settings UI. Entries reference translation keys
 * where the destination renders translated copy and literal text where the
 * destination itself renders hardcoded copy. Section entries are derived from
 * the shared `settingsSections` metadata so the two lists cannot drift.
 *
 * Deliberately NOT imported here: React, panel modules, stores with side
 * effects, or command-palette actions. The catalog must stay cheap enough to
 * load with the Settings shell and safe to unit test in plain Node.
 */

import {
  SETTINGS_SECTION_METADATA,
  SettingsTab,
} from "../settingsSections";
import { isPlethoraCloudAvailable } from "../../../config/product";
import {
  isPlatformCapabilityAvailable,
  resolveCurrentAppPlatform,
  type AppPlatform,
} from "../../../lib/platformCapabilities";

/* ------------------------------------------------------------------------- */
/* Copy + entry types                                                        */
/* ------------------------------------------------------------------------- */

/** A reference to displayed copy: a translation key or already-displayed text. */
export type SettingsSearchCopy =
  | { readonly key: string }
  | { readonly text: string };

export type SettingsSearchKind = "setting" | "group" | "section";

export type SettingsSearchAvailabilityId =
  | "always"
  | "cloud"
  | "desktop"
  | "mobile"
  | "app-updater"
  | "browser-extension"
  | "notebooklm"
  | "android"
  | "ios"
  | "not-ios"
  | "on-device-ai"
  | "companion-enabled"
  | "fsrs-enabled"
  | "daqe-enabled"
  | "tts-lfm3"
  | "tts-system"
  | "tts-language"
  | "tts-speed"
  | "tts-presets";

export interface SettingsSearchEntry {
  /** Stable catalog id, unique across the whole catalog. */
  readonly id: string;
  readonly kind: SettingsSearchKind;
  readonly section: SettingsTab;
  readonly label: SettingsSearchCopy;
  readonly description?: SettingsSearchCopy;
  /** Ordered broad-to-narrow context (section is implicit and not repeated). */
  readonly groupPath?: readonly SettingsSearchCopy[];
  /** Curated everyday-language aliases. Keep this set small and specific. */
  readonly aliases?: readonly SettingsSearchCopy[];
  /** Extra raw search terms (product names, abbreviations, English fallback). */
  readonly keywords?: readonly string[];
  /** Stable id registered by the UI target primitive. */
  readonly targetId: string;
  /**
   * Optional group resolver. When the target itself lives inside collapsed or
   * lazily mounted content, activating this entry first invokes the resolver
   * registered under this id, then waits for `targetId`.
   */
  readonly revealTargetId?: string;
  readonly availability?: SettingsSearchAvailabilityId;
}

/* ------------------------------------------------------------------------- */
/* Copy helpers                                                              */
/* ------------------------------------------------------------------------- */

/** Translation-key copy. */
export const k = (key: string): SettingsSearchCopy => ({ key });
/** Already-displayed literal copy (hardcoded UI text, product names). */
export const lit = (text: string): SettingsSearchCopy => ({ text });

/* ------------------------------------------------------------------------- */
/* Availability                                                              */
/* ------------------------------------------------------------------------- */

export interface SettingsSearchAvailabilitySnapshot {
  readonly cloudAvailable: boolean;
  readonly platform: AppPlatform;
  readonly appUpdaterAvailable: boolean;
  readonly browserExtensionAvailable: boolean;
  readonly notebooklmAvailable: boolean;
  readonly onDeviceAiAvailable: boolean;
  /** Runtime feature state used by conditional panels (never catalog values). */
  readonly companionEnabled: boolean;
  readonly fsrsEnabled: boolean;
  readonly daqeEnabled: boolean;
  readonly ttsProvider: string;
}

export interface SettingsSearchFeatureState {
  companionEnabled?: boolean;
  fsrsEnabled?: boolean;
  daqeEnabled?: boolean;
  ttsProvider?: string;
}

/** Read the same product/platform gates the Settings panels render against. */
export function createSettingsSearchAvailabilitySnapshot(
  features: SettingsSearchFeatureState = {},
): SettingsSearchAvailabilitySnapshot {
  return {
    cloudAvailable: isPlethoraCloudAvailable(),
    platform: resolveCurrentAppPlatform(),
    appUpdaterAvailable: isPlatformCapabilityAvailable("app_updater"),
    browserExtensionAvailable: isPlatformCapabilityAvailable("browser_extension_server"),
    notebooklmAvailable: isPlatformCapabilityAvailable("notebooklm_cli"),
    onDeviceAiAvailable:
      isPlatformCapabilityAvailable("on_device_ai_gemini_nano") ||
      isPlatformCapabilityAvailable("on_device_ai_apple_foundation"),
    companionEnabled: features.companionEnabled === true,
    fsrsEnabled: features.fsrsEnabled === true,
    daqeEnabled: features.daqeEnabled === true,
    ttsProvider: features.ttsProvider ?? "system",
  };
}

export function isSettingsSearchEntryAvailable(
  entry: SettingsSearchEntry,
  snapshot: SettingsSearchAvailabilitySnapshot,
): boolean {
  switch (entry.availability ?? "always") {
    case "always":
      return true;
    case "cloud":
      return snapshot.cloudAvailable;
    case "desktop":
      return snapshot.platform === "desktop";
    case "mobile":
      return snapshot.platform === "android" || snapshot.platform === "ios";
    case "app-updater":
      return snapshot.appUpdaterAvailable;
    case "browser-extension":
      return snapshot.browserExtensionAvailable;
    case "notebooklm":
      return snapshot.notebooklmAvailable;
    case "android":
      return snapshot.platform === "android";
    case "ios":
      return snapshot.platform === "ios";
    case "not-ios":
      return snapshot.platform !== "ios";
    case "on-device-ai":
      return snapshot.onDeviceAiAvailable;
    case "companion-enabled":
      return snapshot.companionEnabled;
    case "fsrs-enabled":
      return snapshot.fsrsEnabled;
    case "daqe-enabled":
      return snapshot.daqeEnabled;
    case "tts-lfm3":
      return snapshot.ttsProvider === "lfm3";
    case "tts-system":
      return snapshot.ttsProvider === "system";
    case "tts-language":
      return !["groq", "system", "pocket", "android"].includes(snapshot.ttsProvider);
    case "tts-speed":
      return snapshot.ttsProvider === "pocket";
    case "tts-presets":
      return !["groq", "system", "lfm3"].includes(snapshot.ttsProvider);
    default:
      return false;
  }
}

/* ------------------------------------------------------------------------- */
/* Section entries (derived from shared metadata)                            */
/* ------------------------------------------------------------------------- */

export const SETTINGS_SECTION_SEARCH_ENTRIES: readonly SettingsSearchEntry[] =
  SETTINGS_SECTION_METADATA.map((section) => ({
    id: `section.${section.id}`,
    kind: "section",
    section: section.id,
    label: k(section.labelKey),
    aliases: section.keywords.map(lit),
    targetId: `section.${section.id}`,
    availability: section.id === SettingsTab.Account ? "cloud" : "always",
  }));

/* ------------------------------------------------------------------------- */
/* Inventory                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * The inventory is ordered; catalog order is the final deterministic
 * tie-breaker after match tier and direct-label coverage.
 */
export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  ...SETTINGS_SECTION_SEARCH_ENTRIES,

  /* ── General ─────────────────────────────────────────────────────────── */
  {
    id: "general.application",
    kind: "group",
    section: SettingsTab.General,
    label: k("settings.application"),
    description: k("settings.applicationDesc"),
    keywords: ["preferences", "basics"],
    targetId: "general.application",
  },
  {
    id: "general.language",
    kind: "setting",
    section: SettingsTab.General,
    label: k("settings.language"),
    description: k("settings.languageHelp"),
    groupPath: [k("settings.application")],
    aliases: [k("settings.searchAlias.language"), lit("locale"), lit("interface language")],
    keywords: ["language", "locale", "english", "chinese", "spanish", "french", "german", "japanese"],
    targetId: "general.language",
  },
  {
    id: "general.defaultView",
    kind: "setting",
    section: SettingsTab.General,
    label: k("settings.defaultView"),
    description: k("settings.defaultViewDesc"),
    groupPath: [k("settings.application")],
    aliases: [lit("startup view"), lit("home screen"), lit("start page")],
    keywords: ["startup", "launch", "start", "view"],
    targetId: "general.defaultView",
  },
  {
    id: "general.restoreSession",
    kind: "setting",
    section: SettingsTab.General,
    label: k("settings.restoreSession"),
    description: k("settings.restoreSessionDesc"),
    groupPath: [k("settings.application")],
    aliases: [lit("reopen tabs"), lit("resume session"), lit("last session")],
    keywords: ["session", "tabs", "startup", "restore"],
    targetId: "general.restoreSession",
  },
  {
    id: "general.residentTabCap",
    kind: "setting",
    section: SettingsTab.General,
    label: k("settings.residentTabCap"),
    description: k("settings.residentTabCapDesc"),
    groupPath: [k("settings.application")],
    aliases: [lit("open tabs limit"), lit("tab limit")],
    keywords: ["tabs", "memory", "limit"],
    targetId: "general.residentTabCap",
  },
  {
    id: "general.readerTabCap",
    kind: "setting",
    section: SettingsTab.General,
    label: k("settings.readerTabCap"),
    description: k("settings.readerTabCapDesc"),
    groupPath: [k("settings.application")],
    aliases: [lit("reader tabs"), lit("document tabs")],
    keywords: ["reader", "tabs", "limit"],
    targetId: "general.readerTabCap",
  },
  {
    id: "general.featurePopups",
    kind: "setting",
    section: SettingsTab.General,
    label: k("settings.featurePopups"),
    description: k("settings.featurePopupsDesc"),
    groupPath: [k("settings.application")],
    aliases: [lit("onboarding tips"), lit("feature discovery"), lit("hints")],
    keywords: ["popups", "tips", "onboarding"],
    targetId: "general.featurePopups",
  },
  {
    id: "general.updates",
    kind: "group",
    section: SettingsTab.General,
    label: k("settings.appVersion"),
    description: k("settings.appVersionDesc"),
    groupPath: [k("settings.application")],
    aliases: [lit("check for updates"), lit("version"), lit("software update")],
    keywords: ["update", "version", "app version"],
    targetId: "general.updates",
    availability: "app-updater",
  },
  {
    id: "general.haptics",
    kind: "group",
    section: SettingsTab.General,
    label: k("haptics.sectionTitle"),
    aliases: [k("settings.searchAlias.vibration"), lit("haptic feedback"), lit("vibrate")],
    keywords: ["vibration", "haptics", "feedback", "vibrate"],
    targetId: "general.haptics",
  },
  {
    id: "general.hapticsEnabled",
    kind: "setting",
    section: SettingsTab.General,
    label: k("haptics.enabledLabel"),
    description: k("haptics.enabledDescription"),
    groupPath: [k("haptics.sectionTitle")],
    aliases: [k("settings.searchAlias.vibration"), lit("vibrate on tap"), lit("haptic feedback")],
    keywords: ["vibration", "haptics", "feedback"],
    targetId: "general.hapticsEnabled",
  },
  {
    id: "general.hapticsIntensity",
    kind: "setting",
    section: SettingsTab.General,
    label: k("haptics.intensityLabel"),
    description: k("haptics.intensityDescription"),
    groupPath: [k("haptics.sectionTitle")],
    aliases: [lit("vibration strength"), lit("haptic strength")],
    keywords: ["intensity", "strength", "haptics", "vibration"],
    targetId: "general.hapticsIntensity",
  },
  {
    id: "general.data",
    kind: "group",
    section: SettingsTab.General,
    label: k("settings.data"),
    description: k("settings.dataDesc"),
    keywords: ["data", "storage", "folder", "backup"],
    targetId: "general.data",
  },
  {
    id: "general.dataLocation",
    kind: "setting",
    section: SettingsTab.General,
    label: k("settings.dataLocation"),
    description: k("settings.dataLocationDesc"),
    groupPath: [k("settings.data")],
    aliases: [lit("open data folder"), lit("storage folder"), lit("data directory")],
    keywords: ["folder", "storage", "directory", "location"],
    targetId: "general.dataLocation",
  },
  {
    id: "general.about",
    kind: "group",
    section: SettingsTab.General,
    label: k("settings.about"),
    description: k("settings.openSourceNoticesDesc"),
    aliases: [lit("third party notices"), lit("licenses"), lit("open source")],
    keywords: ["about", "licenses", "notices"],
    targetId: "general.about",
  },

  /* ── Appearance ──────────────────────────────────────────────────────── */
  {
    id: "appearance.theme",
    kind: "group",
    section: SettingsTab.Appearance,
    label: k("settings.theme"),
    description: k("settings.themeDesc"),
    aliases: [k("settings.searchAlias.darkMode"), lit("light mode"), lit("color scheme"), lit("colors")],
    keywords: ["theme", "dark", "light", "color", "appearance"],
    targetId: "appearance.theme",
  },
  {
    id: "appearance.eink",
    kind: "group",
    section: SettingsTab.Appearance,
    label: lit("Display Mode & E-Ink"),
    description: lit("Monochrome profiles and reader hardware optimizations"),
    aliases: [lit("e-ink"), lit("eink"), lit("monochrome"), lit("display mode")],
    keywords: ["eink", "e-ink", "monochrome", "display"],
    targetId: "appearance.eink",
  },
  {
    id: "appearance.companion",
    kind: "group",
    section: SettingsTab.Appearance,
    label: lit("Plethora Companion"),
    description: lit("An optional ambient bird that occasionally reacts to your reading and study"),
    aliases: [lit("companion bird"), lit("mascot")],
    keywords: ["companion", "bird", "mascot"],
    targetId: "appearance.companion",
  },
  {
    id: "appearance.companionEnabled",
    kind: "setting",
    section: SettingsTab.Appearance,
    label: lit("Show the companion bird"),
    groupPath: [lit("Plethora Companion")],
    aliases: [lit("mascot"), lit("companion")],
    keywords: ["companion", "bird"],
    targetId: "appearance.companionEnabled",
  },
  {
    id: "appearance.companionSpeech",
    kind: "setting",
    section: SettingsTab.Appearance,
    label: lit("Speech frequency"),
    groupPath: [lit("Plethora Companion")],
    aliases: [lit("chatty"), lit("quiet"), lit("how often companion speaks")],
    keywords: ["companion", "speech", "frequency"],
    targetId: "appearance.companionSpeech",
    availability: "always",
  },
  {
    id: "appearance.companionComments",
    kind: "setting",
    section: SettingsTab.Appearance,
    label: lit("Reading comments"),
    groupPath: [lit("Plethora Companion")],
    aliases: [lit("contextual comments")],
    keywords: ["companion", "comments", "reading"],
    targetId: "appearance.companionComments",
    availability: "companion-enabled",
  },
  {
    id: "appearance.companionEncouragement",
    kind: "setting",
    section: SettingsTab.Appearance,
    label: lit("Study encouragement"),
    groupPath: [lit("Plethora Companion")],
    aliases: [lit("celebrations"), lit("encouragement")],
    keywords: ["companion", "study", "encouragement"],
    targetId: "appearance.companionEncouragement",
    availability: "companion-enabled",
  },
  {
    id: "appearance.startup",
    kind: "group",
    section: SettingsTab.Appearance,
    label: lit("Startup"),
    description: lit("The branded launch moment"),
    aliases: [lit("splash screen"), lit("launch animation")],
    keywords: ["startup", "launch", "animation"],
    targetId: "appearance.startup",
  },
  {
    id: "appearance.startupAnimation",
    kind: "setting",
    section: SettingsTab.Appearance,
    label: k("settings.interface.startupAnimationLabel"),
    description: k("settings.interface.startupAnimationHelp"),
    groupPath: [lit("Startup")],
    aliases: [lit("launch animation"), lit("splash")],
    keywords: ["startup", "animation"],
    targetId: "appearance.startupAnimation",
  },
  {
    id: "appearance.animatedBackdrop",
    kind: "group",
    section: SettingsTab.Appearance,
    label: k("settings.animatedBackdrop"),
    description: lit("Adjust the particle animations for animated themes"),
    aliases: [lit("background animation"), lit("particles")],
    keywords: ["animated", "backdrop", "particles"],
    targetId: "appearance.animatedBackdrop",
  },
  {
    id: "appearance.animationsEnabled",
    kind: "setting",
    section: SettingsTab.Appearance,
    label: lit("Enable animated themes"),
    description: lit("Show moving background animations for animated themes. Turn off to save battery and reduce CPU/GPU load, especially on laptops and mobile."),
    groupPath: [lit("Animated Backdrop")],
    aliases: [lit("animations"), lit("background effects"), lit("battery saver")],
    keywords: ["animated", "themes", "background", "particles"],
    targetId: "appearance.animationsEnabled",
  },
  {
    id: "appearance.particleDensity",
    kind: "setting",
    section: SettingsTab.Appearance,
    label: lit("Particle Density"),
    description: lit("How many particles appear on screen"),
    groupPath: [lit("Animated Backdrop")],
    aliases: [lit("particles")],
    keywords: ["particle", "density", "animation"],
    targetId: "appearance.particleDensity",
  },
  {
    id: "appearance.brightness",
    kind: "setting",
    section: SettingsTab.Appearance,
    label: lit("Brightness"),
    description: lit("How strongly the particles glow and accumulate"),
    groupPath: [lit("Animated Backdrop")],
    aliases: [lit("particle brightness"), lit("glow")],
    keywords: ["brightness", "particle", "animation"],
    targetId: "appearance.brightness",
  },
  {
    id: "appearance.typography",
    kind: "group",
    section: SettingsTab.Appearance,
    label: k("settings.typography"),
    description: lit("Font settings"),
    aliases: [lit("font"), lit("typeface"), lit("text")],
    keywords: ["font", "typography", "text"],
    targetId: "appearance.typography",
  },
  {
    id: "appearance.fontFamily",
    kind: "setting",
    section: SettingsTab.Appearance,
    label: k("settings.fontFamily"),
    description: k("settings.fontFamilyDesc"),
    groupPath: [lit("Typography")],
    aliases: [lit("typeface"), lit("font")],
    keywords: ["font", "family", "typeface"],
    targetId: "appearance.fontFamily",
  },
  {
    id: "appearance.fontSize",
    kind: "setting",
    section: SettingsTab.Appearance,
    label: k("settings.fontSize"),
    description: k("settings.fontSizeDesc"),
    groupPath: [k("settings.typography")],
    aliases: [k("settings.searchAlias.biggerText"), lit("text size"), k("settings.searchAlias.interfaceFontSize"), lit("increase font")],
    keywords: ["font", "size", "text", "bigger", "interface"],
    targetId: "appearance.fontSize",
  },
  {
    id: "appearance.display",
    kind: "group",
    section: SettingsTab.Appearance,
    label: k("settings.display"),
    description: lit("Display preferences"),
    aliases: [lit("layout"), lit("interface")],
    keywords: ["display", "layout", "interface"],
    targetId: "appearance.display",
  },
  {
    id: "appearance.interfaceZoom",
    kind: "setting",
    section: SettingsTab.Appearance,
    label: k("settings.interfaceZoom"),
    description: k("settings.interfaceZoomDesc"),
    groupPath: [k("settings.display")],
    aliases: [
      lit("ui zoom"),
      lit("app zoom"),
      lit("zoom in"),
      lit("zoom out"),
      lit("reset zoom"),
      lit("scale interface"),
      lit("interface size"),
      lit("larger interface"),
      lit("smaller interface"),
      lit("make interface bigger"),
      lit("make interface smaller"),
    ],
    keywords: ["zoom", "scale", "interface", "ui", "larger", "smaller", "accessibility"],
    targetId: "appearance.interfaceZoom",
    availability: "desktop",
  },
  {
    id: "appearance.toolbarPosition",
    kind: "setting",
    section: SettingsTab.Appearance,
    label: lit("Toolbar Position"),
    description: lit("Position of the main toolbar (desktop only)"),
    groupPath: [lit("Display")],
    aliases: [lit("toolbar"), lit("sidebar position")],
    keywords: ["toolbar", "position", "sidebar"],
    targetId: "appearance.toolbarPosition",
  },
  {
    id: "appearance.splitView",
    kind: "setting",
    section: SettingsTab.Appearance,
    label: lit("Split View Spawn Gesture"),
    description: lit("Mouse gesture to duplicate the active tab into a vertical split"),
    groupPath: [lit("Display")],
    aliases: [lit("split screen"), lit("middle click"), lit("duplicate tab")],
    keywords: ["split", "view", "gesture", "mouse"],
    targetId: "appearance.splitView",
  },
  {
    id: "appearance.volumeRocker",
    kind: "setting",
    section: SettingsTab.Appearance,
    label: k("settings.volumeRockerScroll"),
    description: k("settings.volumeRockerScrollDesc"),
    groupPath: [k("settings.display")],
    aliases: [k("settings.searchAlias.volumeButtons"), lit("volume keys"), lit("hardware buttons")],
    keywords: ["volume", "rocker", "buttons", "scroll"],
    targetId: "appearance.volumeRocker",
  },
  {
    id: "appearance.compactMode",
    kind: "setting",
    section: SettingsTab.Appearance,
    label: k("settings.compactMode"),
    description: k("settings.compactModeDesc"),
    groupPath: [k("settings.display")],
    aliases: [lit("dense layout"), lit("smaller spacing")],
    keywords: ["compact", "spacing", "layout"],
    targetId: "appearance.compactMode",
  },
  {
    id: "appearance.sidebarWidth",
    kind: "setting",
    section: SettingsTab.Appearance,
    label: k("settings.sidebarWidth"),
    description: k("settings.sidebarWidthDesc"),
    groupPath: [lit("Display")],
    aliases: [lit("toolbar width"), lit("sidebar size")],
    keywords: ["sidebar", "width", "toolbar"],
    targetId: "appearance.sidebarWidth",
  },

  /* ── Shortcuts ───────────────────────────────────────────────────────── */
  {
    id: "shortcuts.keyboard",
    kind: "group",
    section: SettingsTab.Shortcuts,
    label: k("settings.keyboardShortcuts"),
    description: k("settings.keyboardShortcutsDesc"),
    aliases: [lit("hotkeys"), lit("keybindings"), lit("keyboard shortcuts")],
    keywords: ["keyboard", "shortcut", "hotkey", "keybinding"],
    targetId: "shortcuts.keyboard",
  },
  {
    id: "shortcuts.vimium",
    kind: "group",
    section: SettingsTab.Shortcuts,
    label: k("settings.vimiumNavigation"),
    description: k("settings.vimiumNavigationDesc"),
    aliases: [lit("vim navigation"), lit("hint keys")],
    keywords: ["vim", "vimium", "navigation"],
    targetId: "shortcuts.vimium",
  },
  {
    id: "shortcuts.vimiumEnabled",
    kind: "setting",
    section: SettingsTab.Shortcuts,
    label: k("settings.enableVimium"),
    description: k("settings.enableVimiumDesc"),
    groupPath: [k("settings.vimiumNavigation")],
    keywords: ["vim", "vimium", "navigation"],
    targetId: "shortcuts.vimiumEnabled",
  },
  {
    id: "shortcuts.linkHints",
    kind: "setting",
    section: SettingsTab.Shortcuts,
    label: k("settings.linkHintKeys"),
    description: k("settings.linkHintKeysDesc"),
    groupPath: [k("settings.vimiumNavigation")],
    aliases: [lit("hint letters")],
    keywords: ["link", "hints", "vimium"],
    targetId: "shortcuts.linkHints",
  },
  {
    id: "shortcuts.vimReading",
    kind: "group",
    section: SettingsTab.Shortcuts,
    label: k("settings.vimReading"),
    description: k("settings.vimReadingDesc"),
    aliases: [lit("vim card type")],
    keywords: ["vim", "reading", "cards"],
    targetId: "shortcuts.vimReading",
  },
  {
    id: "shortcuts.vimCardType",
    kind: "setting",
    section: SettingsTab.Shortcuts,
    label: k("settings.defaultVimCardType"),
    description: k("settings.defaultVimCardTypeDesc"),
    groupPath: [k("settings.vimReading")],
    keywords: ["vim", "card", "type"],
    targetId: "shortcuts.vimCardType",
  },

  /* ── Notifications ───────────────────────────────────────────────────── */
  {
    id: "notifications.enable",
    kind: "setting",
    section: SettingsTab.Notifications,
    label: k("notificationSettings.enableNotifications"),
    description: lit("Receive notifications for study reminders and due dates"),
    aliases: [lit("enable notifications"), lit("notification permission")],
    keywords: ["notifications", "enable", "permission"],
    targetId: "notifications.enable",
  },
  {
    id: "notifications.types",
    kind: "group",
    section: SettingsTab.Notifications,
    label: k("notificationSettings.notificationTypes"),
    keywords: ["notifications", "types", "reminders"],
    targetId: "notifications.types",
  },
  {
    id: "notifications.studyReminders",
    kind: "setting",
    section: SettingsTab.Notifications,
    label: k("notificationSettings.studyReminders"),
    description: lit("Daily reminders to start your review session"),
    groupPath: [k("notificationSettings.notificationTypes")],
    aliases: [lit("daily reminder")],
    keywords: ["study", "reminder", "daily"],
    targetId: "notifications.studyReminders",
  },
  {
    id: "notifications.dueDateReminders",
    kind: "setting",
    section: SettingsTab.Notifications,
    label: k("notificationSettings.dueDateReminders"),
    description: k("notificationSettings.dueDateNotify"),
    groupPath: [k("notificationSettings.notificationTypes")],
    aliases: [lit("due cards")],
    keywords: ["due", "reminder", "cards"],
    targetId: "notifications.dueDateReminders",
  },
  {
    id: "notifications.sounds",
    kind: "setting",
    section: SettingsTab.Notifications,
    label: k("notificationSettings.notificationSounds"),
    groupPath: [k("notificationSettings.notificationTypes")],
    aliases: [lit("sound"), lit("alert sound")],
    keywords: ["sound", "notification", "alert"],
    targetId: "notifications.sounds",
  },
  {
    id: "notifications.quietHours",
    kind: "setting",
    section: SettingsTab.Notifications,
    label: k("notificationSettings.quietHours"),
    description: k("notificationSettings.quietHoursDesc"),
    groupPath: [k("notificationSettings.additionalOptions")],
    aliases: [lit("do not disturb"), lit("silent hours")],
    keywords: ["quiet", "hours", "dnd"],
    targetId: "notifications.quietHours",
  },
  {
    id: "notifications.badge",
    kind: "setting",
    section: SettingsTab.Notifications,
    label: k("notificationSettings.showBadgeCount"),
    description: k("notificationSettings.showBadgeDesc"),
    groupPath: [k("notificationSettings.additionalOptions")],
    aliases: [lit("app icon badge")],
    keywords: ["badge", "count", "icon"],
    targetId: "notifications.badge",
  },
  {
    id: "notifications.background",
    kind: "group",
    section: SettingsTab.Notifications,
    label: k("notificationSettings.backgroundReminders"),
    keywords: ["background", "reminders", "pwa"],
    targetId: "notifications.background",
  },
  {
    id: "notifications.uiSounds",
    kind: "setting",
    section: SettingsTab.Notifications,
    label: k("notificationSettings.uiSoundEffects"),
    description: k("notificationSettings.uiSoundEffectsDesc"),
    aliases: [lit("interface sounds"), lit("button sounds")],
    keywords: ["ui", "sound", "feedback"],
    targetId: "notifications.uiSounds",
  },
  {
    id: "notifications.test",
    kind: "group",
    section: SettingsTab.Notifications,
    label: k("notificationSettings.sendTest"),
    groupPath: [k("notificationSettings.backgroundReminders")],
    aliases: [lit("test notification")],
    keywords: ["test", "notification"],
    targetId: "notifications.test",
  },

  /* ── Language Learning ───────────────────────────────────────────────── */
  {
    id: "languageLearning.master",
    kind: "group",
    section: SettingsTab.LanguageLearning,
    label: lit("Language Learning"),
    aliases: [lit("language mode"), lit("dictionary"), lit("translation")],
    keywords: ["language", "learning", "reader", "dictionary"],
    targetId: "languageLearning.master",
  },
  {
    id: "languageLearning.enabled",
    kind: "setting",
    section: SettingsTab.LanguageLearning,
    label: lit("Show language-learning tools in readers"),
    description: lit("Language Mode, dictionary peek, translation and practice overlays"),
    groupPath: [lit("Language Learning")],
    aliases: [lit("language mode"), lit("dictionary peek"), lit("translation overlay")],
    keywords: ["language", "reader", "translation"],
    targetId: "languageLearning.enabled",
  },
  {
    id: "languageLearning.suggestions",
    kind: "setting",
    section: SettingsTab.LanguageLearning,
    label: lit("Suggest studying a document as your target language"),
    groupPath: [lit("Language Learning")],
    aliases: [lit("language suggestions")],
    keywords: ["language", "suggestions", "document"],
    targetId: "languageLearning.suggestions",
  },
  {
    id: "languageLearning.profiles",
    kind: "group",
    section: SettingsTab.LanguageLearning,
    label: lit("Language learning profiles"),
    aliases: [lit("target language"), lit("profile"), lit("proficiency")],
    keywords: ["profile", "language", "target", "proficiency"],
    targetId: "languageLearning.profiles",
  },
  {
    id: "languageLearning.createProfile",
    kind: "group",
    section: SettingsTab.LanguageLearning,
    label: lit("Create language learning profile"),
    groupPath: [lit("Language learning profiles")],
    aliases: [lit("new profile"), lit("add language")],
    keywords: ["create", "profile", "language"],
    targetId: "languageLearning.createProfile",
  },

  /* ── Learning ────────────────────────────────────────────────────────── */
  {
    id: "learning.algorithm",
    kind: "group",
    section: SettingsTab.Learning,
    label: k("learningSettings.algorithm"),
    aliases: [lit("scheduler"), lit("fsrs"), lit("spaced repetition")],
    keywords: ["algorithm", "fsrs", "scheduler", "review"],
    targetId: "learning.algorithm",
  },
  {
    id: "learning.scopedOverrides",
    kind: "group",
    section: SettingsTab.Learning,
    label: k("learningSettings.scopedOverrides"),
    description: k("learningSettings.scopedOverridesDesc"),
    groupPath: [k("learningSettings.algorithm")],
    aliases: [lit("per deck settings"), lit("deck overrides")],
    keywords: ["scoped", "overrides", "deck", "scheduler"],
    targetId: "learning.scopedOverrides",
    availability: "fsrs-enabled",
  },
  {
    id: "learning.newCards",
    kind: "group",
    section: SettingsTab.Learning,
    label: k("learningSettings.newCards"),
    aliases: [lit("new card limit"), lit("daily new cards")],
    keywords: ["new", "cards", "limit"],
    targetId: "learning.newCards",
  },
  {
    id: "learning.reviews",
    kind: "group",
    section: SettingsTab.Learning,
    label: k("learningSettings.reviews"),
    aliases: [lit("review limit"), lit("daily reviews")],
    keywords: ["reviews", "limit", "daily"],
    targetId: "learning.reviews",
  },
  {
    id: "learning.lapses",
    kind: "group",
    section: SettingsTab.Learning,
    label: k("learningSettings.lapses"),
    aliases: [lit("lapse steps"), lit("relearning")],
    keywords: ["lapses", "relearning", "steps"],
    targetId: "learning.lapses",
  },
  {
    id: "learning.graduatedInterval",
    kind: "group",
    section: SettingsTab.Learning,
    label: k("learningSettings.graduatedInterval"),
    aliases: [lit("graduating interval"), lit("easy interval")],
    keywords: ["graduated", "interval", "easy"],
    targetId: "learning.graduatedInterval",
  },
  {
    id: "learning.leech",
    kind: "group",
    section: SettingsTab.Learning,
    label: k("learningSettings.leechCards"),
    aliases: [lit("leech threshold")],
    keywords: ["leech", "cards", "threshold"],
    targetId: "learning.leech",
  },
  {
    id: "learning.timezone",
    kind: "group",
    section: SettingsTab.Learning,
    label: k("learningSettings.timezone"),
    description: k("learningSettings.timezoneDesc"),
    aliases: [lit("time zone"), lit("day boundary")],
    keywords: ["timezone", "day", "rollover"],
    targetId: "learning.timezone",
  },
  {
    id: "learning.postpone",
    kind: "group",
    section: SettingsTab.Learning,
    label: k("postpone.settingsTitle"),
    aliases: [lit("postpone reviews"), lit("skip today")],
    keywords: ["postpone", "reviews", "skip"],
    targetId: "learning.postpone",
  },

  /* ── Smart Queues ────────────────────────────────────────────────────── */
  {
    id: "smartQueue.ranking",
    kind: "group",
    section: SettingsTab.SmartQueue,
    label: k("daqeSettings.title"),
    description: k("daqeSettings.intro"),
    aliases: [lit("adaptive ranking"), lit("daqe"), lit("ranking knobs")],
    keywords: ["ranking", "adaptive", "daqe", "priority", "interleaving", "decision model", "download model", "jev", "laya"],
    targetId: "smartQueue.ranking",
  },
  {
    id: "smartQueue.autoRefresh",
    kind: "setting",
    section: SettingsTab.SmartQueue,
    label: k("settings.autoRefresh"),
    description: k("settings.autoRefreshDesc"),
    aliases: [lit("refresh queue"), lit("re-rank")],
    keywords: ["auto", "refresh", "queue"],
    targetId: "smartQueue.autoRefresh",
  },
  {
    id: "smartQueue.refreshInterval",
    kind: "setting",
    section: SettingsTab.SmartQueue,
    label: k("settings.refreshInterval"),
    description: k("settings.refreshIntervalDesc"),
    groupPath: [k("settings.autoRefresh")],
    aliases: [lit("refresh frequency")],
    keywords: ["refresh", "interval", "minutes"],
    targetId: "smartQueue.refreshInterval",
  },

  /* ── Documents ───────────────────────────────────────────────────────── */
  {
    id: "documents.libraryView",
    kind: "group",
    section: SettingsTab.Documents,
    label: k("settingsDocs.libraryView"),
    aliases: [lit("document list"), lit("library layout")],
    keywords: ["library", "view", "documents"],
    targetId: "documents.libraryView",
  },
  {
    id: "documents.compactView",
    kind: "setting",
    section: SettingsTab.Documents,
    label: k("settingsDocs.compactDocumentsView"),
    description: k("settingsDocs.compactDocumentsViewDesc"),
    groupPath: [k("settingsDocs.libraryView")],
    aliases: [lit("compact list"), lit("dense list")],
    keywords: ["compact", "documents", "view"],
    targetId: "documents.compactView",
  },
  {
    id: "documents.smartTagging",
    kind: "group",
    section: SettingsTab.Documents,
    label: lit("Smart Tagging"),
    aliases: [lit("auto tag"), lit("tagging")],
    keywords: ["tag", "smart", "auto"],
    targetId: "documents.smartTagging",
  },
  {
    id: "documents.import",
    kind: "group",
    section: SettingsTab.Documents,
    label: k("settingsDocs.documentImport"),
    aliases: [lit("import documents"), lit("add files")],
    keywords: ["import", "documents", "files"],
    targetId: "documents.import",
  },
  {
    id: "documents.pdf",
    kind: "group",
    section: SettingsTab.Documents,
    label: k("settingsDocs.pdfDocuments"),
    aliases: [lit("pdf options"), lit("pdf reading")],
    keywords: ["pdf", "documents"],
    targetId: "documents.pdf",
  },
  {
    id: "documents.epub",
    kind: "group",
    section: SettingsTab.Documents,
    label: k("settingsDocs.epubDocuments"),
    aliases: [lit("epub options"), lit("ebook")],
    keywords: ["epub", "ebook", "documents"],
    targetId: "documents.epub",
  },
  {
    id: "documents.epubFontSize",
    kind: "setting",
    section: SettingsTab.Documents,
    label: k("settingsDocs.defaultFontSize"),
    description: k("settingsDocs.epubDocuments"),
    groupPath: [k("settingsDocs.epubDocuments")],
    aliases: [lit("EPUB font size"), lit("ebook font size"), lit("bigger text")],
    keywords: ["epub", "font", "size", "reading"],
    targetId: "documents.epubFontSize",
  },
  {
    id: "documents.epubFontFamily",
    kind: "setting",
    section: SettingsTab.Documents,
    label: k("settingsDocs.fontFamily"),
    groupPath: [k("settingsDocs.epubDocuments")],
    aliases: [lit("epub typeface"), lit("ebook font")],
    keywords: ["epub", "font", "family"],
    targetId: "documents.epubFontFamily",
  },
  {
    id: "documents.epubLineHeight",
    kind: "setting",
    section: SettingsTab.Documents,
    label: k("settingsDocs.lineHeight"),
    groupPath: [k("settingsDocs.epubDocuments")],
    aliases: [lit("epub line spacing")],
    keywords: ["epub", "line", "height", "spacing"],
    targetId: "documents.epubLineHeight",
  },
  {
    id: "documents.epubAutoScroll",
    kind: "setting",
    section: SettingsTab.Documents,
    label: k("settingsDocs.autoScroll"),
    description: k("settingsDocs.autoScrollDesc"),
    groupPath: [k("settingsDocs.epubDocuments")],
    keywords: ["epub", "auto", "scroll"],
    targetId: "documents.epubAutoScroll",
  },
  {
    id: "documents.autoSegmentation",
    kind: "group",
    section: SettingsTab.Documents,
    label: k("settingsDocs.autoSegmentation"),
    aliases: [lit("segmentation"), lit("split extracts")],
    keywords: ["segmentation", "extracts", "automatic"],
    targetId: "documents.autoSegmentation",
  },
  {
    id: "documents.ocr",
    kind: "group",
    section: SettingsTab.Documents,
    label: k("settingsDocs.ocr"),
    aliases: [lit("optical character recognition"), lit("scan text")],
    keywords: ["ocr", "scan", "text"],
    targetId: "documents.ocr",
  },
  {
    id: "documents.storage",
    kind: "group",
    section: SettingsTab.Documents,
    label: k("settingsDocs.storage"),
    aliases: [lit("document storage"), lit("cache")],
    keywords: ["storage", "cache", "documents"],
    targetId: "documents.storage",
  },

  /* ── RSS ─────────────────────────────────────────────────────────────── */
  {
    id: "rss.retention",
    kind: "group",
    section: SettingsTab.RSS,
    label: k("settings.rss.articleRetention"),
    description: k("settings.rss.articleRetentionDesc"),
    aliases: [lit("keep articles"), lit("cleanup old articles")],
    keywords: ["rss", "retention", "articles", "cleanup"],
    targetId: "rss.retention",
  },
  {
    id: "rss.keepArticles",
    kind: "setting",
    section: SettingsTab.RSS,
    label: k("settings.rss.keepArticlesFor"),
    groupPath: [k("settings.rss.articleRetention")],
    aliases: [lit("retention days"), lit("keep forever")],
    keywords: ["rss", "keep", "days", "forever"],
    targetId: "rss.keepArticles",
  },
  {
    id: "rss.queueRules",
    kind: "group",
    section: SettingsTab.RSS,
    label: k("settings.rss.queueRules"),
    description: k("settings.rss.queueRulesDesc"),
    aliases: [lit("rss queue settings")],
    keywords: ["rss", "queue", "rules"],
    targetId: "rss.queueRules",
  },
  {
    id: "rss.maxPerSession",
    kind: "setting",
    section: SettingsTab.RSS,
    label: k("settings.rss.maxArticlesPerSession"),
    groupPath: [k("settings.rss.queueRules")],
    aliases: [lit("articles per session")],
    keywords: ["rss", "articles", "session", "limit"],
    targetId: "rss.maxPerSession",
  },
  {
    id: "rss.includeInSmartQueue",
    kind: "setting",
    section: SettingsTab.RSS,
    label: k("settings.rss.includeInSmartQueue"),
    description: k("settings.rss.includeInSmartQueueDesc"),
    groupPath: [k("settings.rss.interactivePreferences")],
    aliases: [lit("include rss in queue")],
    keywords: ["rss", "smart queue", "include"],
    targetId: "rss.includeInSmartQueue",
  },
  {
    id: "rss.onlyUnread",
    kind: "setting",
    section: SettingsTab.RSS,
    label: k("settings.rss.onlyShowUnread"),
    description: k("settings.rss.onlyShowUnreadDesc"),
    groupPath: [k("settings.rss.interactivePreferences")],
    keywords: ["rss", "unread", "filter"],
    targetId: "rss.onlyUnread",
  },
  {
    id: "rss.preferRecent",
    kind: "setting",
    section: SettingsTab.RSS,
    label: k("settings.rss.preferRecentArticles"),
    description: k("settings.rss.preferRecentArticlesDesc"),
    groupPath: [k("settings.rss.interactivePreferences")],
    aliases: [lit("newest first")],
    keywords: ["rss", "recent", "articles"],
    targetId: "rss.preferRecent",
  },
  {
    id: "rss.feedInclusions",
    kind: "group",
    section: SettingsTab.RSS,
    label: k("settings.rss.feedQueueInclusions"),
    description: k("settings.rss.feedQueueInclusionsDesc"),
    aliases: [lit("per feed settings"), lit("include exclude feeds")],
    keywords: ["rss", "feeds", "include", "exclude"],
    targetId: "rss.feedInclusions",
  },

  /* ── AI ──────────────────────────────────────────────────────────────── */
  {
    id: "ai.providers",
    kind: "group",
    section: SettingsTab.AI,
    label: lit("AI Providers"),
    aliases: [lit("openai"), lit("anthropic"), lit("gemini"), lit("ollama"), lit("api key"), lit("llm")],
    keywords: ["ai", "provider", "model", "api key", "openai", "anthropic", "gemini", "ollama"],
    targetId: "ai.providers",
  },
  {
    id: "ai.onDevice",
    kind: "group",
    section: SettingsTab.AI,
    label: lit("On-Device AI"),
    aliases: [lit("gemini nano"), lit("apple intelligence"), lit("local model")],
    keywords: ["on-device", "local", "gemini", "nano", "apple"],
    targetId: "ai.onDevice",
    availability: "on-device-ai",
  },
  {
    id: "ai.learningFeatures",
    kind: "group",
    section: SettingsTab.AI,
    label: lit("AI Learning System Features"),
    aliases: [lit("ai tutor"), lit("card generation"), lit("socratic"), lit("ask library")],
    keywords: ["ai", "learning", "features", "tutor", "cards"],
    targetId: "ai.learningFeatures",
  },
  {
    id: "ai.enableAll",
    kind: "setting",
    section: SettingsTab.AI,
    label: k("ai.activation.enableAll"),
    description: k("ai.activation.enableAllDescription"),
    groupPath: [lit("AI Learning System Features")],
    aliases: [lit("enable all"), lit("turn on ai learning")],
    keywords: ["enable", "all", "activation", "readiness"],
    targetId: "ai.enableAll",
  },
  {
    id: "ai.featureReadiness",
    kind: "group",
    section: SettingsTab.AI,
    label: k("ai.feature.readiness.title"),
    description: k("ai.feature.readiness.description"),
    groupPath: [lit("AI Learning System Features")],
    aliases: [lit("feature readiness"), lit("what needs setup")],
    keywords: ["readiness", "setup", "dependencies", "recovery"],
    targetId: "ai.featureReadiness",
  },
  {
    id: "ai.learnThis",
    kind: "setting",
    section: SettingsTab.AI,
    label: lit("Learn this (Card Extraction)"),
    groupPath: [lit("AI Learning System Features")],
    aliases: [lit("generate flashcards"), lit("extract cards")],
    keywords: ["learn", "cards", "extraction"],
    targetId: "ai.learnThis",
  },
  {
    id: "ai.libraryRag",
    kind: "setting",
    section: SettingsTab.AI,
    label: lit("Ask Library (Semantic Memory RAG)"),
    groupPath: [lit("AI Learning System Features")],
    aliases: [lit("ask library"), lit("rag"), lit("chat with library")],
    keywords: ["ask", "library", "rag", "semantic", "chat"],
    targetId: "ai.libraryRag",
  },
  {
    id: "ai.socratic",
    kind: "setting",
    section: SettingsTab.AI,
    label: lit("Socratic Tutoring"),
    groupPath: [lit("AI Learning System Features")],
    aliases: [lit("tutor"), lit("socratic")],
    keywords: ["socratic", "tutor", "learning"],
    targetId: "ai.socratic",
  },
  {
    id: "ai.occlusion",
    kind: "setting",
    section: SettingsTab.AI,
    label: lit("AI Image Occlusion Assist"),
    groupPath: [lit("AI Learning System Features")],
    aliases: [lit("image occlusion"), lit("diagram labels")],
    keywords: ["occlusion", "image", "diagram"],
    targetId: "ai.occlusion",
  },
  {
    id: "ai.semanticIndex",
    kind: "setting",
    section: SettingsTab.AI,
    label: lit("On-Device Semantic Indexing"),
    groupPath: [lit("AI Learning System Features")],
    aliases: [lit("semantic index"), lit("embeddings")],
    keywords: ["semantic", "index", "embedding"],
    targetId: "ai.semanticIndex",
  },
  {
    id: "ai.answerAssessment",
    kind: "setting",
    section: SettingsTab.AI,
    label: lit("AI Answer Assessment (Review Free-Response)"),
    groupPath: [lit("AI Learning System Features")],
    aliases: [lit("free response grading"), lit("answer evaluation")],
    keywords: ["answer", "assessment", "free", "response"],
    targetId: "ai.answerAssessment",
  },
  {
    id: "ai.prerequisites",
    kind: "setting",
    section: SettingsTab.AI,
    label: k("ai.feature.knowledge.prerequisites"),
    description: k("ai.feature.knowledge.prerequisitesDescription"),
    groupPath: [lit("AI Learning System Features")],
    aliases: [lit("prerequisites"), lit("coverage")],
    keywords: ["knowledge", "prerequisites", "coverage", "evidence"],
    targetId: "ai.prerequisites",
  },
  {
    id: "ai.conceptLinks",
    kind: "setting",
    section: SettingsTab.AI,
    label: k("ai.feature.knowledge.conceptLinks"),
    description: k("ai.feature.knowledge.conceptLinksDescription"),
    groupPath: [lit("AI Learning System Features")],
    aliases: [lit("concept links"), lit("related content")],
    keywords: ["knowledge", "concepts", "links", "relationships"],
    targetId: "ai.conceptLinks",
  },
  {
    id: "ai.extractWorthiness",
    kind: "setting",
    section: SettingsTab.AI,
    label: lit("Passage Extract-Worthiness Scoring"),
    groupPath: [lit("AI Learning System Features")],
    aliases: [lit("margin indicators"), lit("passage scoring")],
    keywords: ["extract", "worthiness", "passage"],
    targetId: "ai.extractWorthiness",
  },
  {
    id: "ai.extractWorthinessRemote",
    kind: "setting",
    section: SettingsTab.AI,
    label: k("ai.passageScoring.remote.title"),
    description: k("ai.passageScoring.remote.description"),
    groupPath: [lit("AI Learning System Features")],
    aliases: [
      lit("remote passage scoring"),
      lit("cloud suggestions"),
      lit("passage allowance"),
    ],
    keywords: ["passage", "extract", "worthiness", "remote", "cloud", "quota", "allowance"],
    targetId: "ai.extractWorthinessRemote",
  },
  {
    id: "ai.agent",
    kind: "setting",
    section: SettingsTab.AI,
    label: lit("Constrained Learning Agent"),
    groupPath: [lit("AI Learning System Features")],
    aliases: [lit("agent"), lit("autonomous assistant")],
    keywords: ["agent", "learning", "assistant"],
    targetId: "ai.agent",
  },
  {
    id: "ai.sessionLearningSuggestions",
    kind: "setting",
    section: SettingsTab.AI,
    label: lit("Recording Session Learning Suggestions"),
    groupPath: [lit("AI Learning System Features")],
    aliases: [lit("session suggestions"), lit("recording flashcards"), lit("transcription learning"), lit("lecture cards")],
    keywords: ["recording", "session", "learning", "suggestions", "transcription", "flashcards"],
    targetId: "ai.sessionLearningSuggestions",
  },
  {
    id: "ai.diagnostics",
    kind: "group",
    section: SettingsTab.AI,
    label: k("aiDiagnostics.button"),
    description: k("aiDiagnostics.featuresHint"),
    groupPath: [lit("AI Learning System Features")],
    aliases: [lit("diagnostics"), lit("why is ai not working")],
    keywords: ["diagnostics", "readiness", "evidence", "recovery"],
    targetId: "ai.diagnostics",
  },
  {
    id: "ai.diagnostics.smoke",
    kind: "setting",
    section: SettingsTab.AI,
    label: k("aiDiagnostics.smoke"),
    description: k("aiDiagnostics.smokeHint"),
    groupPath: [lit("AI Learning System Features"), k("aiDiagnostics.button")],
    aliases: [lit("fixture test"), lit("smoke test")],
    keywords: ["smoke", "fixture", "diagnostics", "test"],
    targetId: "ai.diagnostics.smoke",
    revealTargetId: "ai.diagnostics",
  },
  {
    id: "ai.diagnostics.export",
    kind: "setting",
    section: SettingsTab.AI,
    label: k("aiDiagnostics.export"),
    groupPath: [lit("AI Learning System Features"), k("aiDiagnostics.button")],
    aliases: [lit("export diagnostics"), lit("redacted report")],
    keywords: ["export", "report", "redacted", "diagnostics"],
    targetId: "ai.diagnostics.export",
    revealTargetId: "ai.diagnostics",
  },
  {
    id: "ai.webSearch",
    kind: "group",
    section: SettingsTab.AI,
    label: k("aiSettings.braveApiKey"),
    description: k("aiProvider.braveKeyDesc"),
    aliases: [lit("web search"), lit("brave search"), lit("search API key")],
    keywords: ["web", "search", "brave", "api key"],
    targetId: "ai.webSearch",
  },
  {
    id: "ai.modelSettings",
    kind: "group",
    section: SettingsTab.AI,
    label: k("aiSettings.modelSettings"),
    description: k("aiProvider.modelSettingsDesc"),
    aliases: [lit("context window"), lit("tokens"), lit("model settings")],
    keywords: ["model", "context", "window", "tokens"],
    targetId: "ai.modelSettings",
  },
  {
    id: "ai.mcp",
    kind: "group",
    section: SettingsTab.AI,
    label: lit("MCP Servers"),
    aliases: [lit("model context protocol"), lit("tools"), lit("servers")],
    keywords: ["mcp", "servers", "tools"],
    targetId: "ai.mcp",
  },
  {
    id: "ai.autoGeneration",
    kind: "group",
    section: SettingsTab.AI,
    label: lit("Auto-Generation"),
    description: lit("Automatically generate flashcards from new extracts"),
    aliases: [lit("auto generate cards"), lit("flashcard count")],
    keywords: ["auto", "generate", "flashcards"],
    targetId: "ai.autoGeneration",
  },
  {
    id: "ai.summarization",
    kind: "group",
    section: SettingsTab.AI,
    label: lit("Summarization"),
    aliases: [lit("summaries"), lit("auto summarize")],
    keywords: ["summary", "summarization", "extracts"],
    targetId: "ai.summarization",
  },
  {
    id: "ai.memory",
    kind: "group",
    section: SettingsTab.AI,
    label: lit("AI Long-Term Memory"),
    aliases: [lit("memory"), lit("personalization"), lit("MEMORY.md")],
    keywords: ["memory", "long-term", "personalization"],
    targetId: "ai.memory",
  },
  {
    id: "ai.activeRecall",
    kind: "group",
    section: SettingsTab.AI,
    label: lit("Active Recall"),
    description: lit("While reading, occasionally ask you to recall recently read material from memory"),
    aliases: [lit("recall prompts"), lit("review while reading")],
    keywords: ["active", "recall", "reading"],
    targetId: "ai.activeRecall",
  },
  {
    id: "ai.contextWindow",
    kind: "group",
    section: SettingsTab.AI,
    label: lit("Context Window"),
    aliases: [lit("max tokens"), lit("request context")],
    keywords: ["context", "window", "tokens"],
    targetId: "ai.contextWindow",
  },

  /* ── Audio Transcription ─────────────────────────────────────────────── */
  {
    id: "audioTranscription.models",
    kind: "group",
    section: SettingsTab.AudioTranscription,
    label: k("settings.audioModelsAndProfiles"),
    aliases: [lit("whisper model"), k("settings.searchAlias.speechToText"), lit("speech-to-text"), lit("transcription model")],
    keywords: ["whisper", "model", "speech", "transcription", "download"],
    targetId: "audioTranscription.models",
    revealTargetId: "audioTranscription.reveal.local",
  },
  {
    id: "audioTranscription.enabled",
    kind: "setting",
    section: SettingsTab.AudioTranscription,
    label: k("settings.audioAutoTranscribe"),
    description: k("settings.audioAutoTranscribeDesc"),
    aliases: [lit("auto transcribe"), lit("speech to text")],
    keywords: ["auto", "transcribe", "audio", "speech"],
    targetId: "audioTranscription.enabled",
    availability: "desktop",
    revealTargetId: "audioTranscription.reveal.local",
  },
  {
    id: "audioTranscription.defaultModel",
    kind: "setting",
    section: SettingsTab.AudioTranscription,
    label: k("settings.audioDefaultModel"),
    description: k("settings.audioDefaultModelDesc"),
    groupPath: [k("settings.audioModelsAndProfiles")],
    keywords: ["default", "model", "whisper"],
    targetId: "audioTranscription.defaultModel",
    revealTargetId: "audioTranscription.reveal.local",
  },
  {
    id: "audioTranscription.groqCloud",
    kind: "group",
    section: SettingsTab.AudioTranscription,
    label: k("settings.audioGroqCloud"),
    aliases: [lit("groq whisper"), lit("cloud transcription")],
    keywords: ["groq", "cloud", "transcription"],
    targetId: "audioTranscription.groqCloud",
    revealTargetId: "audioTranscription.reveal.groq",
  },
  {
    id: "audioTranscription.apiConfig",
    kind: "setting",
    section: SettingsTab.AudioTranscription,
    label: k("settings.audioApiConfig"),
    groupPath: [k("settings.audioGroqCloud")],
    aliases: [lit("groq api key"), lit("API key")],
    keywords: ["api", "key", "groq", "credential"],
    targetId: "audioTranscription.apiConfig",
    revealTargetId: "audioTranscription.reveal.groq",
  },
  {
    id: "audioTranscription.language",
    kind: "setting",
    section: SettingsTab.AudioTranscription,
    label: k("settings.audioLanguage"),
    description: k("settings.audioLanguageDesc"),
    aliases: [lit("transcription language")],
    keywords: ["language", "transcription"],
    targetId: "audioTranscription.language",
    revealTargetId: "audioTranscription.reveal.groq",
  },
  {
    id: "audioTranscription.usage",
    kind: "group",
    section: SettingsTab.AudioTranscription,
    label: k("settings.audioUsageThisMonth"),
    aliases: [lit("free tier"), lit("usage"), lit("cost")],
    keywords: ["usage", "cost", "free", "tier"],
    targetId: "audioTranscription.usage",
    revealTargetId: "audioTranscription.reveal.groq",
  },

  /* ── Text to Speech ──────────────────────────────────────────────────── */
  {
    id: "tts.enabled",
    kind: "setting",
    section: SettingsTab.TTS,
    label: lit("Enable Text-to-Speech"),
    aliases: [lit("tts"), k("settings.searchAlias.textToSpeech"), lit("speech synthesis"), lit("read aloud")],
    keywords: ["tts", "text", "speech", "voice"],
    targetId: "tts.enabled",
  },
  {
    id: "tts.lfm3.model",
    kind: "group",
    section: SettingsTab.TTS,
    label: lit("Local LFM3 model"),
    aliases: [lit("LFM3"), lit("offline speech"), lit("local narrator")],
    keywords: ["lfm3", "download", "model", "local", "tts"],
    targetId: "tts.lfm3.model",
    availability: "tts-lfm3",
  },
  {
    id: "tts.localModels",
    kind: "group",
    section: SettingsTab.TTS,
    label: lit("Local TTS models (Hugging Face)"),
    aliases: [lit("download speech model"), lit("Hugging Face"), lit("LFM3 installation")],
    keywords: ["local", "tts", "model", "download", "offline"],
    targetId: "tts.localModels",
    availability: "desktop",
  },
  {
    id: "tts.provider",
    kind: "setting",
    section: SettingsTab.TTS,
    label: k("settings.ttsProvider"),
    aliases: [lit("voice provider"), lit("fal"), lit("groq"), lit("elevenlabs"), lit("openai"), lit("LFM3")],
    keywords: ["provider", "voice", "fal", "groq", "elevenlabs", "openai"],
    targetId: "tts.provider",
  },
  {
    id: "tts.activeVoice",
    kind: "setting",
    section: SettingsTab.TTS,
    label: k("settings.ttsActiveVoice"),
    aliases: [lit("selected voice"), lit("voice")],
    keywords: ["active", "voice"],
    targetId: "tts.activeVoice",
  },
  {
    id: "tts.systemVoices",
    kind: "group",
    section: SettingsTab.TTS,
    label: lit("System Voices"),
    aliases: [lit("device voice"), lit("system speech")],
    keywords: ["system", "voice", "speech"],
    targetId: "tts.systemVoices",
    availability: "tts-system",
  },
  {
    id: "tts.language",
    kind: "setting",
    section: SettingsTab.TTS,
    label: k("settings.ttsLanguage"),
    aliases: [lit("voice language"), lit("speech language")],
    keywords: ["language", "voice", "speech"],
    targetId: "tts.language",
    availability: "tts-language",
  },
  {
    id: "tts.speed",
    kind: "setting",
    section: SettingsTab.TTS,
    label: k("settings.ttsSpeed"),
    aliases: [lit("speech rate"), lit("voice speed")],
    keywords: ["speed", "rate", "voice"],
    targetId: "tts.speed",
    availability: "tts-speed",
  },
  {
    id: "tts.voiceProfiles",
    kind: "group",
    section: SettingsTab.TTS,
    label: k("settings.ttsVoiceProfiles"),
    description: k("settings.ttsVoiceProfilesDesc"),
    aliases: [lit("voice clone"), lit("cloned voice"), lit("voice presets")],
    keywords: ["voice", "profiles", "clone", "cloning"],
    targetId: "tts.voiceProfiles",
  },
  {
    id: "tts.presets",
    kind: "group",
    section: SettingsTab.TTS,
    label: k("settings.ttsPresets"),
    description: k("settings.ttsPresetsDesc"),
    aliases: [lit("generation presets"), lit("voice presets")],
    keywords: ["presets", "generation", "voice"],
    targetId: "tts.presets",
    availability: "tts-presets",
  },
  {
    id: "tts.generation",
    kind: "group",
    section: SettingsTab.TTS,
    label: k("settings.ttsGenerateSpeech"),
    description: k("settings.ttsGenerateSpeechDesc"),
    aliases: [lit("preview voice"), lit("generate audio")],
    keywords: ["generate", "speech", "preview", "audio"],
    targetId: "tts.generation",
  },
  {
    id: "tts.androidModels",
    kind: "group",
    section: SettingsTab.TTS,
    label: k("settings.ttsAndroidModels"),
    aliases: [lit("android voice models"), lit("offline voices")],
    keywords: ["android", "models", "offline", "voice"],
    targetId: "tts.androidModels",
    availability: "android",
  },

  /* ── Embeddings ──────────────────────────────────────────────────────── */
  {
    id: "embeddings.model",
    kind: "group",
    section: SettingsTab.Embeddings,
    label: k("embeddings.title"),
    description: k("embeddings.desc"),
    aliases: [lit("embedding model"), lit("vector model"), lit("openai embeddings"), lit("ollama embeddings")],
    keywords: ["embedding", "model", "vector", "provider", "download model"],
    targetId: "embeddings.model",
  },
  {
    id: "embeddings.index",
    kind: "group",
    section: SettingsTab.Embeddings,
    label: k("settings.embeddings"),
    description: k("settings.embeddingsDesc"),
    aliases: [lit("whole library index"), lit("library index"), lit("rag index"), lit("semantic index")],
    keywords: ["index", "library", "rag", "semantic", "embedding", "enable indexing", "prerequisites", "download model"],
    targetId: "embeddings.index",
  },

  /* ── Integrations ────────────────────────────────────────────────────── */
  {
    id: "integrations.obsidian",
    kind: "group",
    section: SettingsTab.Integrations,
    label: k("integrations.obsidianIntegration"),
    aliases: [lit("obsidian vault"), lit("markdown notes"), lit("sync notes")],
    keywords: ["obsidian", "vault", "notes", "markdown"],
    targetId: "integrations.obsidian",
    revealTargetId: "integrations.reveal.obsidian",
  },
  {
    id: "integrations.anki",
    kind: "group",
    section: SettingsTab.Integrations,
    label: k("integrations.ankiIntegration"),
    aliases: [lit("anki connect"), lit("flashcards to anki")],
    keywords: ["anki", "flashcards", "sync"],
    targetId: "integrations.anki",
    revealTargetId: "integrations.reveal.anki",
  },
  {
    id: "integrations.browserExtension",
    kind: "group",
    section: SettingsTab.Integrations,
    label: k("integrations.browserExtensionServer"),
    aliases: [lit("browser extension"), lit("web clipper"), lit("local server")],
    keywords: ["browser", "extension", "server", "port"],
    targetId: "integrations.browserExtension",
    availability: "browser-extension",
    revealTargetId: "integrations.reveal.extension",
  },
  {
    id: "integrations.youtubePlaylist",
    kind: "group",
    section: SettingsTab.Integrations,
    label: k("integrations.youtubePlaylists"),
    aliases: [lit("youtube playlist"), lit("playlist import"), lit("playlist auto import")],
    keywords: ["youtube", "playlist", "import", "videos", "auto-import"],
    targetId: "integrations.youtubePlaylist",
    revealTargetId: "integrations.reveal.youtube",
  },
  {
    id: "integrations.youtubePlaylist.defaults",
    kind: "group",
    section: SettingsTab.Integrations,
    label: lit("Defaults for new playlists"),
    aliases: [lit("playlist interval"), lit("playlist defaults"), lit("playlist priority")],
    keywords: ["youtube", "playlist", "interval", "priority", "consecutive", "defaults"],
    targetId: "integrations.youtubePlaylist.defaults",
    revealTargetId: "integrations.reveal.youtube",
  },
  {
    id: "integrations.youtubeCookies",
    kind: "group",
    section: SettingsTab.Integrations,
    label: k("integrations.youtubeAuthCookies"),
    aliases: [lit("youtube login"), lit("cookies")],
    keywords: ["youtube", "cookies", "auth"],
    targetId: "integrations.youtubeCookies",
    revealTargetId: "integrations.reveal.youtube-cookies",
  },
  {
    id: "integrations.youtubeTranscripts",
    kind: "group",
    section: SettingsTab.Integrations,
    label: k("integrations.youtubeTranscripts"),
    aliases: [lit("transcript server"), lit("youtube transcripts")],
    keywords: ["youtube", "transcript", "server"],
    targetId: "integrations.youtubeTranscripts",
    revealTargetId: "integrations.reveal.youtube-transcript",
  },
  {
    id: "integrations.notebooklm",
    kind: "group",
    section: SettingsTab.Integrations,
    label: k("integrations.notebooklm"),
    description: k("integrations.notebooklmDesc"),
    aliases: [lit("notebook lm"), lit("google notebooklm")],
    keywords: ["notebooklm", "notebook", "google"],
    targetId: "integrations.notebooklm",
    availability: "notebooklm",
    revealTargetId: "integrations.reveal.notebooklm",
  },
  {
    id: "integrations.publicApi",
    kind: "group",
    section: SettingsTab.Integrations,
    label: lit("Pro Public API & Webhooks"),
    aliases: [lit("webhooks"), lit("public API"), lit("API keys")],
    keywords: ["api", "webhooks", "pro", "cloud"],
    targetId: "integrations.publicApi",
    availability: "cloud",
    revealTargetId: "integrations.reveal.api-tokens",
  },

  /* ── Cloud Storage ───────────────────────────────────────────────────── */
  {
    id: "cloudStorage.providers",
    kind: "group",
    section: SettingsTab.CloudStorage,
    label: lit("Cloud Storage Provider"),
    aliases: [lit("google drive"), lit("dropbox"), lit("onedrive"), lit("connect storage")],
    keywords: ["cloud", "storage", "google drive", "dropbox", "onedrive"],
    targetId: "cloudStorage.providers",
  },
  {
    id: "cloudStorage.sync",
    kind: "group",
    section: SettingsTab.CloudStorage,
    label: k("cloudStorage.title"),
    aliases: [lit("plethora cloud sync"), lit("encrypted sync")],
    keywords: ["cloud", "sync", "backup", "encrypted", "sync mode", "automatic backups", "restore"],
    targetId: "cloudStorage.sync",
    availability: "cloud",
  },

  /* ── Import / Export ─────────────────────────────────────────────────── */
  {
    id: "importExport.completeBackup",
    kind: "group",
    section: SettingsTab.ImportExport,
    label: k("importExport.completeBackup"),
    description: k("importExport.completeBackupDesc"),
    aliases: [lit("backup"), lit("full backup"), lit("open backup restore")],
    keywords: ["backup", "restore", "data"],
    targetId: "importExport.completeBackup",
  },
  {
    id: "importExport.collectionArchive",
    kind: "group",
    section: SettingsTab.ImportExport,
    label: k("importExport.collectionArchive"),
    description: k("importExport.collectionArchiveDesc"),
    aliases: [lit("export collection"), lit("archive")],
    keywords: ["archive", "collection", "export"],
    targetId: "importExport.collectionArchive",
  },
  {
    id: "importExport.legacyExport",
    kind: "group",
    section: SettingsTab.ImportExport,
    label: k("importExport.exportLegacy"),
    description: k("importExport.exportLegacyDesc"),
    aliases: [lit("export data"), lit("json export"), lit("csv export")],
    keywords: ["export", "json", "csv", "data"],
    targetId: "importExport.legacyExport",
  },
  {
    id: "importExport.import",
    kind: "group",
    section: SettingsTab.ImportExport,
    label: k("importExport.importData"),
    description: k("importExport.importDataDesc"),
    aliases: [lit("import data"), lit("restore from file")],
    keywords: ["import", "data", "restore"],
    targetId: "importExport.import",
  },
  {
    id: "importExport.scheduledBackups",
    kind: "group",
    section: SettingsTab.ImportExport,
    label: k("importExport.scheduledBackups"),
    description: k("importExport.scheduledBackupsDesc"),
    aliases: [lit("auto backup"), lit("backup frequency"), lit("backup location")],
    keywords: ["scheduled", "backup", "frequency", "location"],
    targetId: "importExport.scheduledBackups",
  },
  {
    id: "importExport.anki",
    kind: "group",
    section: SettingsTab.ImportExport,
    label: k("importExport.exportToAnki"),
    description: k("importExport.exportToAnkiDesc"),
    aliases: [lit("anki export"), lit("apkg")],
    keywords: ["anki", "export", "apkg"],
    targetId: "importExport.anki",
  },

  /* ── Privacy ─────────────────────────────────────────────────────────── */
  {
    id: "privacy.center",
    kind: "group",
    section: SettingsTab.Privacy,
    label: lit("Privacy Center"),
    aliases: [lit("privacy disclosures"), lit("data practices")],
    keywords: ["privacy", "disclosures", "data"],
    targetId: "privacy.center",
  },
  {
    id: "privacy.localOnlyShield",
    kind: "group",
    section: SettingsTab.Privacy,
    label: lit("Local-Only Shield"),
    aliases: [lit("offline only"), lit("block network")],
    keywords: ["local", "offline", "shield", "network"],
    targetId: "privacy.localOnlyShield",
  },
  {
    id: "privacy.cloudDisclosure",
    kind: "group",
    section: SettingsTab.Privacy,
    label: lit("Cloud AI Disclosure"),
    aliases: [lit("cloud AI"), lit("data leaving device")],
    keywords: ["cloud", "ai", "disclosure", "privacy"],
    targetId: "privacy.cloudDisclosure",
  },
  {
    id: "privacy.exportCloudData",
    kind: "group",
    section: SettingsTab.Privacy,
    label: lit("Machine-Readable Data Export"),
    aliases: [lit("export cloud data"), lit("download account data")],
    keywords: ["export", "account", "cloud", "data"],
    targetId: "privacy.exportCloudData",
    availability: "cloud",
  },
  {
    id: "privacy.deleteAccount",
    kind: "group",
    section: SettingsTab.Privacy,
    label: lit("Delete Account & Wipe Cloud Storage"),
    aliases: [lit("delete account"), lit("erase cloud data")],
    keywords: ["delete", "account", "erase", "cloud"],
    targetId: "privacy.deleteAccount",
    availability: "cloud",
  },

  /* ── Handbook / Help / Account ──────────────────────────────────────── */
  {
    id: "handbook.userHandbook",
    kind: "group",
    section: SettingsTab.Handbook,
    label: k("handbook.userHandbook"),
    description: k("handbook.browseChapters"),
    aliases: [lit("guide"), lit("manual"), lit("documentation")],
    keywords: ["handbook", "guide", "manual", "documentation"],
    targetId: "handbook.userHandbook",
  },
  {
    id: "handbook.search",
    kind: "setting",
    section: SettingsTab.Handbook,
    label: k("handbook.search"),
    groupPath: [k("handbook.userHandbook")],
    aliases: [lit("search handbook"), lit("find in guide")],
    keywords: ["search", "handbook", "find"],
    targetId: "handbook.search",
  },
  {
    id: "help.replayTour",
    kind: "setting",
    section: SettingsTab.Help,
    label: k("onboarding.tour.replayTour"),
    aliases: [lit("replay tutorial"), lit("show tour again")],
    keywords: ["tour", "onboarding", "replay", "tutorial"],
    targetId: "help.replayTour",
  },
  {
    id: "help.resetOnboarding",
    kind: "setting",
    section: SettingsTab.Help,
    label: k("onboarding.tour.resetOnboarding"),
    description: k("onboarding.tour.resetOnboardingDesc"),
    groupPath: [k("onboarding.tour.replayTour")],
    aliases: [lit("reset tour"), lit("reset onboarding")],
    keywords: ["reset", "onboarding", "tour"],
    targetId: "help.resetOnboarding",
  },
  {
    id: "account.profile",
    kind: "group",
    section: SettingsTab.Account,
    label: lit("Account profile"),
    aliases: [lit("subscription"), lit("pro"), lit("billing"), lit("devices")],
    keywords: ["account", "profile", "subscription", "billing"],
    targetId: "account.profile",
    availability: "cloud",
  },
];

/** Look up a catalog entry by stable id (tests + navigation recovery). */
export function findSettingsSearchEntry(
  id: string,
): SettingsSearchEntry | undefined {
  return SETTINGS_SEARCH_ENTRIES.find((entry) => entry.id === id);
}
