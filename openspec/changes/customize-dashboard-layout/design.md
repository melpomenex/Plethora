# Design: Customize Dashboard Layout

## Architecture

1. **Store (`src/stores/dashboardLayoutStore.ts`)**
   - `DashboardSectionId`: `"focus" | "quick-actions" | "continue-reading" | "capture-activity" | "todays-horizon" | "study-plans" | "progress" | "quick-tip" | "quick-review"`.
   - `DashboardQuickActionId`: `"continue-reading" | "queue" | "review" | "documents" | "rss" | "audiobooks" | "analytics" | "settings"`.
   - Normalization merges any newly added default IDs onto the end of persisted orders and strips unknown/duplicate IDs, ensuring forward compatibility and resilience to corrupted `localStorage` payloads.
   - `window.addEventListener("storage", ...)` syncs layout updates across tabs/windows.

2. **Inline Edit Mode UX (`DashboardTab.tsx` + `DashboardSectionFrame`)**
   - **Why inline instead of a modal**: Users see their real Dashboard sections in-place without an interrupting dialog, and hidden sections collapse to a compact 1-line bar during editing so the whole layout remains easy to scan and reorder.
   - **Pointer + Keyboard Reordering**: Each section bar has a dedicated drag handle (`touch-action: none`, `select-none`, pointer capture, layout-midpoint drop detection with a drop marker) AND explicit `Move up` / `Move down` buttons (`IconButton` with `min-h-10 min-w-10`) plus polite `aria-live` announcements.
   - **Quick Actions Customization**: Inside the Quick Actions section while customizing, each tile exposes visibility toggle (`Check` / `EyeSlash` state) and `Move left` / `Move right` controls.
   - **MD3 Compliance**: Uses `Button`, `IconButton`, `Switch`, and semantic surface/outline tokens (`bg-surface-container-low`, `border-outline-variant`, `text-on-surface`) without shadows on in-flow elements or color-only state indicators.
