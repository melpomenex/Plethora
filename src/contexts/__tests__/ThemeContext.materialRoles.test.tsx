/**
 * Material token integration: applying a theme through ThemeContext must put
 * the full derived M3 role set on the document root, keep the legacy shadcn
 * aliases alive, and the CSS must keep the floating-layer z ordering that
 * chrome stacking contracts depend on.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

describe("floating layer z-scale ordering contract", () => {
  const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");

  function zIndex(varName: string): number {
    const match = css.match(new RegExp(`${varName}:\\s*(\\d+)`));
    if (!match) throw new Error(`${varName} missing from index.css`);
    return Number(match[1]);
  }

  it("orders nav < overlay < dialog < menu < snackbar < tooltip < critical", () => {
    const order = [
      zIndex("--md-z-nav"),
      zIndex("--md-z-overlay"),
      zIndex("--md-z-dialog"),
      zIndex("--md-z-menu"),
      zIndex("--md-z-snackbar"),
      zIndex("--md-z-tooltip"),
      zIndex("--md-z-critical"),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i], `layer ${i}`).toBeGreaterThan(order[i - 1]);
    }
    // The anchored selection toolbar must stay above the marketing-capture
    // chrome (z-[9997]).
    expect(zIndex("--md-z-critical")).toBeGreaterThan(9997);
  });
});
