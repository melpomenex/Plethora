/**
 * Mobile Bottom Navigation
 *
 * Provides mobile-optimized bottom navigation with:
 * - Tab-based navigation
 * - Active state indicators
 * - Badge notifications
 * - Responsive icon sizing
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsInSimple,
  ArrowsLeftRight,
  ArrowsOutSimple,
  BookOpen,
  Brain,
  ChartBar,
  ChatCircleDots,
  Download,
  Gear,
  Headphones,
  House,
  Image,
  List,
  MagnifyingGlass,
  Microphone,
  Newspaper,
  Planet,
  Rss,
  Scissors,
  TextT,
  X,
} from "@phosphor-icons/react";
import { toggleFullscreen, isFullscreen, isFullscreenSupported, isPWA } from "../../lib/pwa";
import { useI18n } from "../../lib/i18n";
import { useTabsStore } from "../../stores";
import type { TabType } from "../../stores/tabsStore";
import { usePWAStatus } from "../pwa";
import { useOverlayDismissal } from "../../hooks/useOverlayDismissal";
import { TOUR_ANCHORS } from "../onboarding/tour/anchors";
import {
  DashboardTab,
  QueueTab,
  ReviewTab,
  DocumentsTab,
  AnalyticsTab,
  SettingsTab,
  RSSReader,
  NewsletterDirectoryTab,
  PodcastTab,
  AudiobooksTab,
  KnowledgeSphereTab,
  ImageRegistryTab,
  ExtractsTab,
  DocumentQATab,
} from "../tabs/TabRegistry";
import {
  getPlatformCapability,
  isPlatformCapabilityUnavailable,
  type PlatformAvailability,
  type PlatformCapabilityId,
} from "../../lib/platformCapabilities";

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  tabType: TabType;
  tabTitle: string;
  tabIcon: string;
  tabContent: React.ComponentType;
  closable: boolean;
  badge?: "review" | "rss";
  /**
   * Platform capability governing this destination (§3.1). Items whose
   * capability is unavailable on the current platform are filtered out of
   * the bottom bar and rendered marked-unavailable (disabled + reason) in
   * the overflow sheet where discoverability matters (§3.4).
   */
  capabilityId?: PlatformCapabilityId;
}

/**
 * Onboarding-tour anchor IDs for each primary bottom-nav item. Steps declare
 * `[desktop-candidate, mobile-candidate]` and the resolver picks whichever is
 * rendered, so one tour definition serves both shells.
 */
const MOBILE_NAV_ANCHORS: Record<string, string | undefined> = {
  dashboard: TOUR_ANCHORS.mobileNavDashboard,
  documents: TOUR_ANCHORS.mobileNavDocuments,
  queue: TOUR_ANCHORS.mobileNavQueue,
  review: TOUR_ANCHORS.mobileNavReview,
  settings: TOUR_ANCHORS.mobileNavSettings,
};

// Primary nav items shown on mobile bottom nav
// Exported for the capability lint-style test (§1.4) and the matrix doc test.
export const primaryNavItems: NavItem[] = [
  {
    id: "dashboard",
    label: "nav.dashboard",
    icon: House,
    tabType: "dashboard",
    tabTitle: "nav.dashboard",
    tabIcon: "📊",
    tabContent: DashboardTab,
    closable: false,
    capabilityId: "tab_dashboard",
  },
  {
    id: "queue",
    label: "nav.queue",
    icon: TextT,
    tabType: "queue",
    tabTitle: "nav.queue",
    tabIcon: "📚",
    tabContent: QueueTab,
    closable: true,
    badge: "review",
    capabilityId: "tab_queue",
  },
  {
    id: "review",
    label: "review.title",
    icon: Brain,
    tabType: "review",
    tabTitle: "review.title",
    tabIcon: "🧠",
    tabContent: ReviewTab,
    closable: true,
    capabilityId: "tab_review",
  },
  {
    id: "documents",
    label: "nav.documents",
    icon: BookOpen,
    tabType: "documents",
    tabTitle: "nav.documents",
    tabIcon: "📂",
    tabContent: DocumentsTab,
    closable: true,
    capabilityId: "tab_documents",
  },
  {
    id: "settings",
    label: "nav.settings",
    icon: Gear,
    tabType: "settings",
    tabTitle: "nav.settings",
    tabIcon: "⚙️",
    tabContent: SettingsTab,
    closable: true,
    capabilityId: "tab_settings",
  },
];

export const allNavItems: NavItem[] = [
  ...primaryNavItems,
  {
    id: "extracts",
    label: "extractsTab.title",
    icon: Scissors,
    tabType: "extracts",
    tabTitle: "extractsTab.title",
    tabIcon: "✂️",
    tabContent: ExtractsTab,
    closable: true,
    capabilityId: "tab_extracts",
  },
  {
    id: "image-registry",
    label: "imageRegistry.pageTitle",
    icon: Image,
    tabType: "image-registry",
    tabTitle: "imageRegistry.pageTitle",
    tabIcon: "🖼️",
    tabContent: ImageRegistryTab,
    closable: true,
    capabilityId: "tab_image_registry",
  },
  {
    id: "doc-qa",
    label: "documentQA.title",
    icon: ChatCircleDots,
    tabType: "doc-qa",
    tabTitle: "documentQA.title",
    tabIcon: "💬",
    tabContent: DocumentQATab,
    closable: true,
    capabilityId: "tab_doc_qa",
  },
  {
    id: "rss",
    label: "rssReader.title",
    icon: Rss,
    tabType: "rss",
    tabTitle: "rssReader.title",
    tabIcon: "📰",
    tabContent: RSSReader,
    closable: true,
    badge: "rss",
    capabilityId: "tab_rss",
  },
  {
    id: "newsletter",
    label: "newsletterDirectory.title",
    icon: Newspaper,
    tabType: "newsletter",
    tabTitle: "newsletterDirectory.title",
    tabIcon: "📬",
    tabContent: NewsletterDirectoryTab,
    closable: true,
    capabilityId: "tab_newsletter",
  },
  {
    id: "analytics",
    label: "nav.analytics",
    icon: ChartBar,
    tabType: "analytics",
    tabTitle: "nav.analytics",
    tabIcon: "📈",
    tabContent: AnalyticsTab,
    closable: true,
    capabilityId: "tab_analytics",
  },
  {
    id: "podcast",
    label: "podcastManager.podcasts",
    icon: Microphone,
    tabType: "podcast",
    tabTitle: "podcastManager.podcasts",
    tabIcon: "🎙️",
    tabContent: PodcastTab,
    closable: true,
    capabilityId: "tab_podcast",
  },
  {
    id: "audiobook",
    label: "toolbar.audiobooks",
    icon: Headphones,
    tabType: "audiobook",
    tabTitle: "toolbar.audiobooks",
    tabIcon: "🎧",
    tabContent: AudiobooksTab,
    closable: true,
    capabilityId: "tab_audiobook",
  },
  {
    id: "knowledge-sphere",
    label: "universe.title",
    icon: Planet,
    tabType: "knowledge-sphere",
    tabTitle: "universe.title",
    tabIcon: "🌐",
    tabContent: KnowledgeSphereTab,
    closable: true,
    capabilityId: "tab_knowledge_sphere",
  },
];

interface MobileNavigationProps {
  dueCount?: number;
  unreadCount?: number;
  hidden?: boolean;
}

/** §3.1: resolve a nav item's platform availability (ungated ⇒ available). */
function navItemAvailability(item: NavItem): PlatformAvailability {
  return item.capabilityId
    ? getPlatformCapability(item.capabilityId)
    : { available: true };
}

export function MobileNavigation({
  dueCount = 0,
  unreadCount = 0,
  hidden = false,
}: MobileNavigationProps) {
  const { t } = useI18n();
  const { tabs, rootPane, addTab, setActiveTab } = useTabsStore();
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [fullscreenState, setFullscreenState] = useState(isFullscreen());
  const [showIosInstallHelp, setShowIosInstallHelp] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreSheetRef = useRef<HTMLDivElement>(null);
  const moreWasOpenRef = useRef(false);
  const { canInstall, install, isStandalone } = usePWAStatus();
  const isIOSDevice =
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);
  const showInstallCta = !isStandalone && (canInstall || isIOSDevice);
  
  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreenState(isFullscreen());
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('msfullscreenchange', handleFullscreenChange);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('msfullscreenchange', handleFullscreenChange);
    };
  }, []);
  
  const handleFullscreenToggle = async () => {
    await toggleFullscreen();
    setFullscreenState(isFullscreen());
    setShowMoreMenu(false);
  };
  
  // Show fullscreen option only when:
  // 1. Fullscreen API is supported
  // 2. Not in PWA fullscreen mode already (manifest display: fullscreen)
  const showFullscreenOption = isFullscreenSupported() && !isPWA();
  
  const activeTabId = useMemo(() => {
    const findFirstTabPane = (pane: typeof rootPane): { type: "tabs"; id: string; tabIds: string[]; activeTabId: string | null } | null => {
      if (pane.type === "tabs") return pane;
      if (pane.type === "split") {
        for (const child of pane.children) {
          const found = findFirstTabPane(child);
          if (found) return found;
        }
      }
      return null;
    };
    const firstPane = findFirstTabPane(rootPane);
    return firstPane?.activeTabId ?? null;
  }, [rootPane]);
  
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [tabs, activeTabId]
  );

  const moreItems = useMemo(
    () => allNavItems.filter((item) => !primaryNavItems.find((primary) => primary.id === item.id)),
    []
  );

  // §3.1: filter nav destinations through the platform capability registry.
  // Platform detection is synchronous and immutable, so a plain read per
  // render is sufficient.
  const availablePrimaryNavItems = useMemo(
    () => primaryNavItems.filter((item) => navItemAvailability(item).available),
    []
  );
  const availableMoreItems = useMemo(
    () => moreItems.filter((item) => navItemAvailability(item).available),
    [moreItems]
  );
  const unavailableMoreItems = useMemo(
    () => moreItems.filter((item) => !navItemAvailability(item).available),
    [moreItems]
  );
  const activeMoreItem = moreItems.find(
    (item) => item.tabType === activeTab?.type,
  );
  const moreMenuActive = Boolean(activeMoreItem);

  const closeMoreMenu = () => {
    setShowMoreMenu(false);
    setShowIosInstallHelp(false);
  };

  useOverlayDismissal(showMoreMenu, closeMoreMenu, 100);

  useEffect(() => {
    if (showMoreMenu) {
      moreWasOpenRef.current = true;
      window.requestAnimationFrame(() => {
        moreSheetRef.current
          ?.querySelector<HTMLElement>("button")
          ?.focus();
      });
      return;
    }
    if (moreWasOpenRef.current) {
      moreWasOpenRef.current = false;
      moreButtonRef.current?.focus();
    }
  }, [showMoreMenu]);

  const openTab = (item: NavItem) => {
    if (item.tabType === "queue") {
      // "Queue" can mean either the list view or Scroll Mode — reactivate
      // whichever was more recently active instead of always the list.
      const { getMostRecentTabOfTypes, findPaneContainingTab: findPane, setActiveTab: activateTab } = useTabsStore.getState();
      const recentQueueTab = getMostRecentTabOfTypes(["queue", "queue-scroll"]);
      if (recentQueueTab) {
        const pane = findPane(recentQueueTab.id);
        if (pane) {
          activateTab(pane.id, recentQueueTab.id);
          return;
        }
      }
    }

    const existing = tabs.find((tab) => tab.type === item.tabType);
    if (existing) {
      // Find the pane containing this tab and activate it
      const findPaneContainingTab = (pane: typeof rootPane): { type: "tabs"; id: string; tabIds: string[]; activeTabId: string | null } | null => {
        if (pane.type === "tabs" && pane.tabIds.includes(existing.id)) return pane;
        if (pane.type === "split") {
          for (const child of pane.children) {
            const found = findPaneContainingTab(child);
            if (found) return found;
          }
        }
        return null;
      };
      const pane = findPaneContainingTab(rootPane);
      if (pane) {
        setActiveTab(pane.id, existing.id);
      }
      return;
    }

    addTab({
      title: t(item.tabTitle),
      icon: item.tabIcon,
      type: item.tabType,
      content: item.tabContent,
      closable: item.closable,
    });
  };

  const handleInstall = async () => {
    if (isIOSDevice) {
      setShowIosInstallHelp((prev) => !prev);
      return;
    }

    await install();
    setShowMoreMenu(false);
  };

  return (
    <>
    <nav className={`mobile-bottom-nav ${hidden ? "hidden" : ""}`} aria-hidden={hidden}>
      {availablePrimaryNavItems.map((item) => {
        const active = activeTab?.type === item.tabType;
        const badge =
          item.badge === "review"
            ? dueCount
            : item.badge === "rss"
            ? unreadCount
            : 0;

        return (
          <button
            key={item.id}
            type="button"
            data-tour={MOBILE_NAV_ANCHORS[item.id]}
            onClick={() => {
              openTab(item);
              setShowMoreMenu(false);
              setShowIosInstallHelp(false);
            }}
            className={`mobile-nav-item ${active ? 'active' : ''}`}
            aria-label={t(item.label)}
            aria-current={active ? "page" : undefined}
          >
            <span className="mobile-nav-item-background" aria-hidden="true" />
            <div className="mobile-nav-icon">
              <item.icon className="w-6 h-6" />
              {badge > 0 && (
                <span className="mobile-nav-badge">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </div>
            <span className="mobile-nav-label">{t(item.label)}</span>
          </button>
        );
      })}
      <button
        ref={moreButtonRef}
        type="button"
        onClick={() => {
          setShowMoreMenu(true);
          setShowIosInstallHelp(false);
        }}
        className={`mobile-nav-item ${showMoreMenu || moreMenuActive ? 'active' : ''}`}
        aria-label={
          activeMoreItem
            ? `${t("mobileNav.moreSections")}: ${t(activeMoreItem.label)}`
            : t("mobileNav.moreSections")
        }
        aria-expanded={showMoreMenu}
        aria-current={moreMenuActive ? "page" : undefined}
      >
        <span className="mobile-nav-item-background" aria-hidden="true" />
        <div className="mobile-nav-icon">
          <List className="w-6 h-6" />
        </div>
        <span className="mobile-nav-label">
          {activeMoreItem ? t(activeMoreItem.label) : t("nav.more")}
        </span>
      </button>
    </nav>

      {/* More List Overlay */}
      {showMoreMenu && (
        <div 
          className="mobile-more-overlay"
          onClick={closeMoreMenu}
        >
          <div 
            ref={moreSheetRef}
            className="mobile-more-sheet"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-more-title"
          >
            <div className="mobile-more-header">
              <div>
                <p className="mobile-more-eyebrow">{t("nav.more")}</p>
                <h3 id="mobile-more-title" className="mobile-more-title">{t("mobileNav.sectionsAndActions")}</h3>
              </div>
              <button
                type="button"
                onClick={closeMoreMenu}
                className="mobile-more-close"
                aria-label={t("mobileNav.closeMenu")}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mobile-more-section">
              {availableMoreItems.map((item) => {
                const Icon = item.icon;
                const badge =
                  item.badge === "review"
                    ? dueCount
                    : item.badge === "rss"
                    ? unreadCount
                    : 0;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      openTab(item);
                      setShowMoreMenu(false);
                      setShowIosInstallHelp(false);
                    }}
                    className={`mobile-more-item ${activeTab?.type === item.tabType ? "mobile-more-item-active" : ""}`}
                    aria-current={activeTab?.type === item.tabType ? "page" : undefined}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="flex-1 text-left">{t(item.label)}</span>
                    {badge > 0 && (
                      <span className="px-2 py-0.5 bg-primary text-primary-foreground text-xs rounded-full">
                        {badge}
                      </span>
                    )}
                  </button>
                 );
               })}
              {/* §3.4: destinations unavailable on this platform stay visible
                  in the overflow sheet — marked unavailable (disabled + i18n
                  reason) so their absence is explainable, never a dead
                  button. */}
              {unavailableMoreItems.map((item) => {
                const Icon = item.icon;
                const availability = navItemAvailability(item);
                let reasonKey = "platform.unavailable.generic";
                if (isPlatformCapabilityUnavailable(availability)) {
                  reasonKey =
                    availability.explanationKey ??
                    `platform.unavailable.${availability.reason}`;
                }
                return (
                  <div
                    key={item.id}
                    className="mobile-more-item opacity-50 cursor-not-allowed"
                    role="button"
                    aria-disabled="true"
                  >
                    <Icon className="w-5 h-5" />
                    <span className="flex-1 text-left">
                      {t(item.label)}
                      <span className="block text-xs text-muted-foreground">
                        {t(reasonKey)}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mobile-more-section">
              <button
                type="button"
                data-tour={TOUR_ANCHORS.mobileWorkspaceSwitcher}
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("open-workspace-switcher"));
                  setShowMoreMenu(false);
                }}
                className="mobile-more-item"
              >
                <ArrowsLeftRight className="w-5 h-5" />
                <span className="flex-1 text-left">{t("workspace.switchWorkspace")}</span>
              </button>
              <button
                type="button"
                data-tour={TOUR_ANCHORS.mobileCommandPalette}
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("command-palette-open"));
                  setShowMoreMenu(false);
                  setShowIosInstallHelp(false);
                }}
                className="mobile-more-item"
              >
                <MagnifyingGlass className="w-5 h-5" />
                <span className="flex-1 text-left">{t("mobileNav.search")}</span>
              </button>

              {showInstallCta && (
                <button
                  type="button"
                  onClick={handleInstall}
                  className="mobile-more-item"
                >
                  <Download className="w-5 h-5" />
                  <span className="flex-1 text-left">
                    {isIOSDevice ? t("mobileNav.addHomeScreen") : t("mobileNav.installApp")}
                  </span>
                </button>
              )}

              {showFullscreenOption && (
                <button
                  onClick={handleFullscreenToggle}
                  className="mobile-more-item"
                >
                  {fullscreenState ? (
                    <>
                      <ArrowsInSimple className="w-5 h-5" />
                      <span className="flex-1 text-left">{t("mobileNav.exitFullscreen")}</span>
                    </>
                  ) : (
                    <>
                      <ArrowsOutSimple className="w-5 h-5" />
                      <span className="flex-1 text-left">{t("mobileNav.enterFullscreen")}</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {showInstallCta && isIOSDevice && showIosInstallHelp && (
              <div className="mobile-more-tip">
                <p className="mobile-more-tip-title">{t("mobileNav.addToHomeScreenTip")}</p>
                <p className="mobile-more-tip-copy" dangerouslySetInnerHTML={{ __html: t("mobileNav.addToHomeScreenDesc") }} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Mobile settings panel with PWA-specific options
 */
export function MobileSettingsPanel({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [settings, setSettings] = useState({
    autoSync: true,
    offlineMode: true,
    notifications: true,
    vibration: true,
    fontSize: "medium",
  });

  if (!isOpen) return null;

  return (
    <div className="mobile-settings-panel" onClick={onClose}>
      <div className="mobile-settings-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="mobile-settings-header">
          <h2 className="mobile-settings-title">{t("mobileNav.settings")}</h2>
          <button
            onClick={onClose}
            className="mobile-settings-close"
            aria-label={t("mobileNav.closeSettings")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* PWA Status */}
        <div className="mobile-settings-section">
          <h3 className="mobile-settings-section-title">{t("mobileNav.appStatus")}</h3>
          <PWastatusIndicator />
        </div>

        {/* Sync Settings */}
        <div className="mobile-settings-section">
          <h3 className="mobile-settings-section-title">{t("mobileNav.syncOffline")}</h3>
          <ToggleSetting
            label={t("mobileNav.autoSyncContent")}
            checked={settings.autoSync}
            onChange={(checked) => setSettings({ ...settings, autoSync: checked })}
          />
          <ToggleSetting
            label={t("mobileNav.offlineReadingMode")}
            description={t("mobileNav.offlineReadingModeDesc")}
            checked={settings.offlineMode}
            onChange={(checked) => setSettings({ ...settings, offlineMode: checked })}
          />
        </div>

        {/* Reading Settings */}
        <div className="mobile-settings-section">
          <h3 className="mobile-settings-section-title">{t("mobileNav.reading")}</h3>
          <SelectSetting
            label={t("settings.fontSize")}
            value={settings.fontSize}
            options={[
              { value: "small", label: t("mobileNav.fontSmall") },
              { value: "medium", label: t("mobileNav.fontMedium") },
              { value: "large", label: t("mobileNav.fontLarge") },
            ]}
            onChange={(value) => setSettings({ ...settings, fontSize: value })}
          />
        </div>

        {/* Interface Settings */}
        <div className="mobile-settings-section">
          <h3 className="mobile-settings-section-title">{t("mobileNav.interface")}</h3>
          <ToggleSetting
            label={t("settings.notifications")}
            description={t("mobileNav.notificationsDesc")}
            checked={settings.notifications}
            onChange={(checked) => setSettings({ ...settings, notifications: checked })}
          />
          <ToggleSetting
            label={t("mobileNav.vibrationFeedback")}
            checked={settings.vibration}
            onChange={(checked) => setSettings({ ...settings, vibration: checked })}
          />
        </div>

        {/* Cache Management */}
        <div className="mobile-settings-section">
          <h3 className="mobile-settings-section-title">{t("mobileNav.storage")}</h3>
          <ButtonSetting
            label={t("mobileNav.clearOfflineData")}
            description={t("mobileNav.clearOfflineDataDesc")}
            onClick={() => {
            }}
          />
          <ButtonSetting
            label={t("mobileNav.downloadForOffline")}
            description={t("mobileNav.downloadForOfflineDesc")}
            onClick={() => {
            }}
          />
        </div>

        {/* Save button */}
        <div className="mobile-settings-footer">
          <button
            onClick={() => {
              onClose();
            }}
            className="mobile-settings-save"
          >
            {t("mobileNav.saveSettings")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * PWA Status indicator
 */
export function PWastatusIndicator() {
  const { t } = useI18n();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isPWA, setIsPWA] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const checkPWA = () => {
      setIsPWA(
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true
      );
    };

    checkPWA();
    window.matchMedia("(display-mode: standalone)").addEventListener("change", checkPWA);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <div className="pwa-status">
      <div className={`pwa-status-item ${isPWA ? "installed" : ""}`}>
        <span className="pwa-status-dot" />
        <span className="text-xs text-muted-foreground">
          {isPWA ? t("mobileNav.installedAsApp") : t("mobileNav.installAsApp")}
        </span>
      </div>
      <div className={`pwa-status-item ${isOnline ? "online" : "offline"}`}>
        <span className="pwa-status-dot" />
        <span className="text-xs text-muted-foreground">
          {isOnline ? t("mobileNav.online") : t("mobileNav.offline")}
        </span>
      </div>
    </div>
  );
}

/**
 * Toggle setting component
 */
function ToggleSetting({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="toggle-setting">
      <div className="toggle-setting-info">
        <span className="toggle-setting-label">{label}</span>
        {description && (
          <span className="toggle-setting-desc">{description}</span>
        )}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`toggle-switch ${checked ? "on" : "off"}`}
        role="switch"
        aria-checked={checked}
        tabIndex={0}
      >
        <span className="toggle-slider" />
      </button>
    </div>
  );
}

/**
 * Select setting component
 */
function SelectSetting({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="select-setting">
      <label className="select-setting-label">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="select-setting-select"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Button setting component
 */
function ButtonSetting({
  label,
  description,
  onClick,
}: {
  label: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="button-setting"
    >
      <div className="button-setting-info">
        <span className="button-setting-label">{label}</span>
        {description && (
          <span className="button-setting-desc">{description}</span>
        )}
      </div>
    </button>
  );
}
