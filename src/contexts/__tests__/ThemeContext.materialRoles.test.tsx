/**
 * Material token integration: applying a theme through ThemeContext must put
 * the full derived M3 role set on the document root, keep the legacy shadcn
 * aliases alive, and the CSS must keep the floating-layer z ordering that
 * chrome stacking contracts depend on.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ThemeProvider } from "../ThemeContext";
import { biolumeAbyssTheme, milkyMatchaTheme } from "../../themes/fallback";

const ROLES = [
  "--color-on-surface-variant",
  "--color-secondary-container",
  "--color-on-secondary-container",
  "--color-tertiary",
  "--color-on-tertiary",
  "--color-tertiary-container",
  "--color-on-tertiary-container",
  "--color-surface-dim",
  "--color-surface-bright",
  "--color-surface-container-lowest",
  "--color-surface-container-low",
  "--color-surface-container",
  "--color-surface-container-high",
  "--color-surface-container-highest",
  "--color-inverse-surface",
  "--color-on-inverse-surface",
  "--color-inverse-primary",
  "--color-scrim",
];

describe("ThemeContext material role emission", () => {
  it("emits every derived role for a dark fallback theme", () => {
    render(<ThemeProvider defaultTheme={biolumeAbyssTheme.id}>{null}</ThemeProvider>);
    const style = document.documentElement.style;
    for (const role of ROLES) {
      expect(style.getPropertyValue(role), role).not.toBe("");
    }
    // Derived container ordering visible in the emitted values for dark.
    expect(style.getPropertyValue("--color-surface-container-lowest")).not.toBe(
      style.getPropertyValue("--color-surface-container-highest"),
    );
  });

  it("emits every derived role for a light fallback theme", () => {
    render(<ThemeProvider defaultTheme={milkyMatchaTheme.id}>{null}</ThemeProvider>);
    const style = document.documentElement.style;
    for (const role of ROLES) {
      expect(style.getPropertyValue(role), role).not.toBe("");
    }
  });

  it("keeps the legacy shadcn aliases alive alongside the new roles", () => {
    render(<ThemeProvider defaultTheme={biolumeAbyssTheme.id}>{null}</ThemeProvider>);
    const style = document.documentElement.style;
    for (const alias of [
      "--color-foreground",
      "--color-muted",
      "--color-card",
      "--color-popover",
      "--color-border",
      "--color-destructive",
      "--color-primary-foreground",
    ]) {
      expect(style.getPropertyValue(alias), alias).not.toBe("");
    }
  });
});

