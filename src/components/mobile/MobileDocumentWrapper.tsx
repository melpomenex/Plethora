/**
 * Mobile Document Wrapper with Pull-to-Refresh
 *
 * Wraps document viewers (PDF, EPUB, YouTube, Markdown) with:
 * - Pull-to-refresh functionality
 * - Touch gesture support
 * - Mobile-specific optimizations
 */

import { useState, useCallback } from "react";
import { PullToRefresh } from "./PullToRefresh";
import { useMobileShell } from "../../hooks/useMobileShell";
import { useDocumentStore } from "../../stores/documentStore";

interface MobileDocumentWrapperProps {
  documentId: string;
  documentTitle: string;
  children: React.ReactNode;
  onRefresh?: () => Promise<void>;
  className?: string;
}

export function MobileDocumentWrapper({
  documentId,
  documentTitle: _documentTitle,
  children,
  onRefresh,
  className = "",
}: MobileDocumentWrapperProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isMobile = useMobileShell();

  // Reload the current document data when the host has no specialized action.
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);

    try {
      if (onRefresh) {
        await onRefresh();
      } else {
        const document = await useDocumentStore.getState().hydrateDocument(documentId);
        if (!document) throw new Error(`Document ${documentId} could not be refreshed`);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [documentId, onRefresh]);

  // If not mobile, just return children without wrapper
  if (!isMobile) {
    return <>{children}</>;
  }

  return (
    <PullToRefresh
      onRefresh={handleRefresh}
      disabled={isRefreshing}
      className={`mobile-document-wrapper ${className}`}
    >
      {children}
    </PullToRefresh>
  );
}

/**
 * Hook to use mobile document wrapper functionality
 */
export function useMobileDocumentRefresh(documentId: string) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const document = await useDocumentStore.getState().hydrateDocument(documentId);
      if (!document) throw new Error(`Document ${documentId} could not be refreshed`);
    } finally {
      setIsRefreshing(false);
    }
  }, [documentId]);

  return { isRefreshing, refresh };
}
