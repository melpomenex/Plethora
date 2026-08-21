/**
 * Shared class contract for the Scroll Mode launcher controls (desktop
 * ReviewQueueView + mobile MobileQueueView). Prominent (enabled) state is
 * built exclusively from the semantic mode-accent tokens — never literal
 * colors — so every theme renders a distinct, contrast-safe accent (see the
 * theme-mode-accent capability). The muted background is expressed with a
 * Tailwind opacity modifier over `--color-mode-accent`; contrast against that
 * blend is guaranteed by the resolver.
 *
 * The disabled state stays an ordinary disabled control and deliberately does
 * not use the mode-accent treatment. Keyboard focus keeps the platform's
 * default focus outline; the accent border must not suppress it.
 */
export const scrollModeEntryProminentClasses = [
  "border border-mode-accent/60 bg-mode-accent/10 text-mode-accent",
  "hover:bg-mode-accent/20 hover:border-mode-accent",
].join(" ");

export const scrollModeEntryDisabledClasses = "disabled:opacity-50 disabled:cursor-not-allowed";
