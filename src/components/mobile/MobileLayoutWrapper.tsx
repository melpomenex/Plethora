/**
 * Mobile Layout Wrapper
 *
 * Wraps the application with mobile-specific components:
 * - PWA install prompt
 * - Offline indicator
 * - Mobile bottom navigation
 */

import { useEffect, useState } from "react";
import { PWAInstallPrompt, OfflineIndicator } from "./PWAComponents";
import { MobileNavigation } from "./MobileNavigation";
import { useQueueStore } from "../../stores";
import { useMobileShell } from "../../hooks/useMobileShell";
import { useEdgeSwipeBack } from "../../hooks/useEdgeSwipeBack";
import { AdaptiveAppScaffold } from "../layout/AdaptiveAppScaffold";
import { requestApplicationBack } from "../../lib/applicationBack";

interface MobileLayoutWrapperProps {
  children: React.ReactNode;
}

export function MobileLayoutWrapper({ children }: MobileLayoutWrapperProps) {
  const queueItems = useQueueStore((state) => state.items);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isMobile = useMobileShell();

  // --- Global mobile back gesture ---
  // Only the intentional left-edge back gesture is global. Horizontal swipes
  // elsewhere stay with the active view so Library scrolling cannot navigate
  // between tabs or away from the current screen.
  const gesturesDisabled = !isMobile || isFullscreen;

  useEdgeSwipeBack(
    () => {
      requestApplicationBack();
    },
    { disabled: gesturesDisabled },
  );

  // Calculate badge counts
  const dueCount = queueItems.filter(item => {
    if (item.itemType === "document") {
      const doc = item.dueDate ? new Date(item.dueDate) : null;
      return doc && doc <= new Date();
    }
    return false;
  }).length;

  const unreadCount = 0; // TODO: Implement RSS unread count

  useEffect(() => {
    const updateFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    updateFullscreen();
    document.addEventListener("fullscreenchange", updateFullscreen);
    document.addEventListener("webkitfullscreenchange", updateFullscreen as EventListener);

    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreen);
      document.removeEventListener("webkitfullscreenchange", updateFullscreen as EventListener);
    };
  }, []);

  useEffect(() => {
    const handleSystemBack = (event: Event) => {
      if (requestApplicationBack()) event.preventDefault();
    };
    window.addEventListener("incrementum:system-back", handleSystemBack);
    return () =>
      window.removeEventListener("incrementum:system-back", handleSystemBack);
  }, []);

  // Desktop (and wide tablets in landscape) render the full tabbed interface.
  // useMobileShell() returns true for native phones/tablets-in-portrait and for
  // narrow browser/PWA windows — including inside the actual native Android/iOS
  // build, where the old `isTauri()` gate used to suppress the mobile shell.
  if (!isMobile) {
    return (
      <AdaptiveAppScaffold mobile={false} fullscreen={isFullscreen}>
        {children}
      </AdaptiveAppScaffold>
    );
  }

  return (
    <AdaptiveAppScaffold mobile fullscreen={isFullscreen}>
      {/* PWA Components */}
      <PWAInstallPrompt />
      <OfflineIndicator />

      {/* Main Content */}
      {/* The top safe-area inset is applied once by the inner .app-shell (via the
          @media (max-width: 1024px) rule in index.css). Don't add .safe-top here —
          that re-applies the inset and compounds it, wasting screen space. */}
      <div className="mobile-main-content">
        {children}
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileNavigation
        dueCount={dueCount}
        unreadCount={unreadCount}
        hidden={isFullscreen}
      />
    </AdaptiveAppScaffold>
  );
}
