import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { en } from "../locales/en";
import { de } from "../locales/de";
import { es } from "../locales/es";
import { fr } from "../locales/fr";
import { ja } from "../locales/ja";
import { zh } from "../locales/zh";
import { recentFeatureEn } from "../locales/recentFeatures/en";
import { recentFeatureDe } from "../locales/recentFeatures/de";
import { recentFeatureEs } from "../locales/recentFeatures/es";
import { recentFeatureFr } from "../locales/recentFeatures/fr";
import { recentFeatureJa } from "../locales/recentFeatures/ja";
import { recentFeatureZh } from "../locales/recentFeatures/zh";
import {
  RECENT_FEATURE_LOCALE_CODES,
  RECENT_FEATURE_SOURCE_EXCEPTIONS,
  RECENT_FEATURE_SURFACE_INVENTORY,
  RECENT_FEATURE_TRANSLATION_PREFIXES,
} from "../recentFeatureSurfaceInventory";
import { loadLocale, t } from "../index";
import { useSettingsStore } from "../../../stores/settingsStore";
import { studyErrorMessage, studyErrorMessageForKey } from "../../study-plans/studyErrorMessage";
import { getTabTitleTranslationKey, tabContentRegistry } from "../../../components/tabs/TabRegistry";
import { StudyPlanStateNotice } from "../../../components/study-plans/StudyPlanStateNotice";
import { QuestionValidationIssues } from "../../../components/study-plans/assessments/QuestionValidationIssues";
import { PlanHomeView } from "../../../components/study-plans/home/PlanHomeView";
import { MediaCompatibilityPanel } from "../../../components/viewer/MediaCompatibilityPanel";
import type { MediaCompatibilityState } from "../../../hooks/useMediaCompatibility";
import type { MediaCompatibilityJobEvent, MediaInspection, MediaPlaybackPlan } from "../../media/types";
import type { StudyPlanDetail } from "../../../types/learningPaths";

const root = path.resolve(__dirname, "../../../..");
const srcRoot = path.join(root, "src");
const localeDictionaries: Record<string, Record<string, string>> = { en, zh, es, de, fr, ja };
const explicitFeatureDictionaries: Record<string, Record<string, string>> = {
  en: recentFeatureEn,
  zh: recentFeatureZh,
  es: recentFeatureEs,
  de: recentFeatureDe,
  fr: recentFeatureFr,
  ja: recentFeatureJa,
};

const userFacingAttributes = new Set([
  "aria-label", "aria-description", "aria-valuetext", "placeholder", "title", "alt",
  "label", "description", "helperText", "errorText", "emptyMessage", "loadingMessage",
  "confirmLabel", "cancelLabel", "submitLabel", "heading", "subtitle", "caption",
  "tooltip", "message", "successMessage", "failureMessage", "warningMessage", "infoMessage",
  "text", "actionLabel", "buttonLabel", "dialogTitle", "dialogDescription", "error",
  "emptyState", "statusText", "retryLabel", "closeLabel", "subtext", "detail", "prompt",
  "explanation", "instructions", "emptyDescription",
]);
const feedbackCalls = new Set([
  "setError", "setSuccess", "setMessage", "showToast", "notify", "announce", "alert",
  "confirm", "prompt", "setStatus", "setFeedback", "setNotice", "setErrorBanner",
]);
const translationKeys = new Set(Object.keys(en));

type LiteralFinding = { file: string; line: number; kind: string; value: string };

function normalizeDisplayText(value: string): string {
  return value.replace(/[\s\u00a0]+/g, " ").trim();
}

function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFilesUnder(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}

function isVisible(value: string): boolean {
  const normalized = value
    .replace(/&(?:ldquo|rdquo|mdash|ndash|hellip|nbsp);/gi, " ")
    .replace(/\{\w+\}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 && /[\p{L}]/u.test(normalized);
}

function scanVisibleLiterals(file: string, source: string): LiteralFinding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings: LiteralFinding[] = [];
  const add = (node: ts.Node, value: string, kind: string) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!isVisible(normalized) || translationKeys.has(normalized)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    findings.push({ file: path.relative(root, file), line: line + 1, kind, value: normalized });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) add(node, node.text, "jsx-text");

    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sf);
      if (userFacingAttributes.has(name)) {
        if (ts.isStringLiteral(node.initializer)) add(node.initializer, node.initializer.text, `attribute:${name}`);
        if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          const expression = node.initializer.expression;
          if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
            add(expression, expression.text, `attribute:${name}`);
          } else if (ts.isTemplateExpression(expression)) {
            add(expression, templateText(expression), `attribute:${name}`);
          }
        }
      }
    }

    if (ts.isJsxExpression(node) &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      !(ts.isJsxElement(node.parent) && node.parent.openingElement.tagName.getText(sf) === "style") && node.expression &&
      (ts.isStringLiteral(node.expression) || ts.isNoSubstitutionTemplateLiteral(node.expression))) {
      add(node.expression, node.expression.text, "jsx-expression");
    }

    if (ts.isTemplateExpression(node)) {
      let renderedNode: ts.Node = node;
      while (ts.isConditionalExpression(renderedNode.parent) &&
        (renderedNode.parent.whenTrue === renderedNode || renderedNode.parent.whenFalse === renderedNode)) {
        renderedNode = renderedNode.parent;
      }
      const parent = renderedNode.parent;
      if (ts.isJsxExpression(parent) && parent.expression === renderedNode) {
        const attribute = parent.parent;
        if (!ts.isJsxAttribute(attribute) || userFacingAttributes.has(attribute.name.getText(sf))) {
          add(node, templateText(node), ts.isJsxAttribute(attribute)
            ? `attribute:${attribute.name.getText(sf)}`
            : "jsx-template");
        }
      }
    }

    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && ts.isConditionalExpression(node.parent) &&
      (node.parent.whenTrue === node || node.parent.whenFalse === node)) {
      let ancestor: ts.Node | undefined = node.parent.parent;
      while (ancestor && !ts.isJsxExpression(ancestor) && !ts.isJsxAttribute(ancestor)) ancestor = ancestor.parent;
      if (ancestor && ts.isJsxExpression(ancestor)) {
        if (ts.isJsxAttribute(ancestor.parent) && userFacingAttributes.has(ancestor.parent.name.getText(sf))) {
          add(node, node.text, `attribute:${ancestor.parent.name.getText(sf)}`);
        } else if (!ts.isJsxAttribute(ancestor.parent)) {
          add(node, node.text, "jsx-conditional");
        }
      }
    }

    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      ts.isBinaryExpression(node.parent) && node.parent.right === node &&
      [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.parent.operatorToken.kind)) {
      let ancestor: ts.Node | undefined = node.parent.parent;
      while (ancestor && !ts.isJsxExpression(ancestor) && !ts.isJsxAttribute(ancestor)) ancestor = ancestor.parent;
      if (ancestor && ts.isJsxExpression(ancestor)) {
        if (ts.isJsxAttribute(ancestor.parent) && userFacingAttributes.has(ancestor.parent.name.getText(sf))) {
          add(node, node.text, `attribute:${ancestor.parent.name.getText(sf)}`);
        } else if (!ts.isJsxAttribute(ancestor.parent)) {
          add(node, node.text, "jsx-fallback");
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf).split(".").at(-1) ?? "";
      const isToast = ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(sf) === "toast" &&
        ["success", "error", "info", "warning"].includes(node.expression.name.text);
      if ((feedbackCalls.has(callee) || isToast) && node.arguments[0] &&
        (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))) {
        add(node.arguments[0], node.arguments[0].text, `feedback:${callee}`);
      }
      if (callee === "studyErrorMessage" && node.arguments[1] && ts.isStringLiteral(node.arguments[1])) {
        add(node.arguments[1], node.arguments[1].text, "error-fallback");
      }
    }

    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.initializer)) {
      const propertyName = node.name.getText(sf).replace(/^['"]|['"]$/g, "");
      if (userFacingAttributes.has(propertyName)) {
        const parent = node.parent;
        const hasLocalizedKey = ts.isObjectLiteralExpression(parent) && parent.properties.some((property) =>
          ts.isPropertyAssignment(property) && property.name.getText(sf).replace(/^['"]|['"]$/g, "") === "labelKey");
        if (!hasLocalizedKey) add(node.initializer, node.initializer.text, `property:${propertyName}`);
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

function templateText(node: ts.TemplateExpression): string {
  let value = node.head.text;
  for (const span of node.templateSpans) value += `{value}${span.literal.text}`;
  return value;
}

function inventorySourceFiles(): string[] {
  const files = new Set<string>();
  for (const surface of RECENT_FEATURE_SURFACE_INVENTORY) {
    for (const relative of surface.files) files.add(path.join(root, relative));
    for (const relative of surface.directories) {
      const directory = path.join(root, relative);
      if (existsSync(directory)) for (const file of sourceFilesUnder(directory)) files.add(file);
    }
  }
  return [...files].sort();
}

function studyPlanMessageKeys(): string[] {
  const directory = path.join(srcRoot, "lib", "study-plans");
  const keys = new Set<string>();
  const featurePrefixes = RECENT_FEATURE_TRANSLATION_PREFIXES;
  for (const file of sourceFilesUnder(directory).filter((candidate) =>
    !candidate.split(path.sep).includes("__tests__") && !/\.(?:test|spec)\.tsx?$/.test(candidate))) {
    const source = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node) && featurePrefixes.some((prefix) => node.text.startsWith(prefix))) {
        keys.add(node.text);
      }
      if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.initializer)) {
        const property = node.name.getText(sf).replace(/^['"]|['"]$/g, "");
        const key = node.initializer.text;
        if (property === "messageKey" ||
          ((property === "reasonKey" || property === "blockedReasonKey") && key.includes("."))) {
          keys.add(key);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return [...keys].sort();
}

function sourceExceptions(): readonly { file: string; property: string; value?: string; reason: string }[] {
  return RECENT_FEATURE_SOURCE_EXCEPTIONS as readonly { file: string; property: string; value?: string; reason: string }[];
}

function localeCoverageIssues(
  locale: string,
  explicit: Record<string, string>,
  dictionary: Record<string, string>,
) {
  const keys = Object.keys(recentFeatureEn);
  const missingExplicit = keys
    .filter((key) => !Object.prototype.hasOwnProperty.call(explicit, key))
    .map((key) => `${locale}:${key}`);
  const unresolved = keys
    .filter((key) => !dictionary[key]?.trim() || dictionary[key] === key ||
      (!Object.prototype.hasOwnProperty.call(explicit, key) && dictionary[key] === recentFeatureEn[key]))
    .map((key) => `${locale}:${key}`);
  const placeholderMismatches = keys.filter((key) => {
    const sourceTokens = [...recentFeatureEn[key].matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    const translatedTokens = [...(explicit[key] ?? "").matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    return JSON.stringify(sourceTokens) !== JSON.stringify(translatedTokens);
  }).map((key) => `${locale}:${key}`);
  return { missingExplicit, unresolved, placeholderMismatches };
}

describe("recent feature i18n coverage", () => {
  const featureKeys = Object.keys(recentFeatureEn).sort();

  it("inventory paths exist and cover all current Study Plans modules", () => {
    const missing: string[] = [];
    for (const file of inventorySourceFiles()) {
      if (!existsSync(file)) missing.push(path.relative(root, file));
    }
    expect(missing).toEqual([]);
    expect(inventorySourceFiles().some((file) => file.endsWith("/study-plans/StudyPlansScrollContainer.tsx"))).toBe(true);
  });

  it.each(RECENT_FEATURE_LOCALE_CODES.filter((locale) => locale !== "en"))(
    "%s explicitly translates every audited key with matching placeholders",
    (locale) => {
      const explicit = explicitFeatureDictionaries[locale];
      const dict = localeDictionaries[locale];
      const issues = localeCoverageIssues(locale, explicit, dict);
      expect(issues.missingExplicit, `${locale}: missing explicit keys ${issues.missingExplicit.slice(0, 10).join(", ")}`).toEqual([]);
      expect(issues.unresolved, `${locale}: unresolved keys ${issues.unresolved.slice(0, 10).join(", ")}`).toEqual([]);
      expect(issues.placeholderMismatches, `${locale}: placeholder mismatches ${issues.placeholderMismatches.slice(0, 10).join(", ")}`).toEqual([]);
    },
  );

  it("explicitly translates every literal Study Plans message and localized reason key", () => {
    const missing = studyPlanMessageKeys().filter((key) => !featureKeys.includes(key));
    expect(missing, `missing feature dictionary keys: ${missing.join(", ")}`).toEqual([]);

    const missingLocales = RECENT_FEATURE_LOCALE_CODES.flatMap((locale) => {
      const dictionary = explicitFeatureDictionaries[locale];
      return studyPlanMessageKeys()
        .filter((key) => !Object.prototype.hasOwnProperty.call(dictionary, key))
        .map((key) => `${locale}:${key}`);
    });
    expect(missingLocales, `missing explicit locale values: ${missingLocales.slice(0, 20).join(", ")}`).toEqual([]);
  });

  it("reports missing explicit values, inherited English, and placeholder mismatches with locale and key", () => {
    const key = "mediaCompatibility.preparing.progressTime";
    const missingExplicit = { ...recentFeatureZh };
    delete missingExplicit[key];
    const inheritedEnglish = { ...en, ...missingExplicit };
    const missingIssues = localeCoverageIssues("zh", missingExplicit, inheritedEnglish);
    expect(missingIssues.missingExplicit).toContain(`zh:${key}`);
    expect(missingIssues.unresolved).toContain(`zh:${key}`);

    const wrongPlaceholder = { ...recentFeatureZh, [key]: "{var0} 秒" };
    const placeholderIssues = localeCoverageIssues("zh", wrongPlaceholder, { ...en, ...wrongPlaceholder });
    expect(placeholderIssues.placeholderMismatches).toContain(`zh:${key}`);
    expect(recentFeatureZh[key]).not.toBe(recentFeatureEn[key]);
  });

  it("resolves literal translation calls in inventoried modules", () => {
    const unresolved: string[] = [];
    const audited = new Set(RECENT_FEATURE_TRANSLATION_PREFIXES);
    for (const file of inventorySourceFiles()) {
      const source = readFileSync(file, "utf8");
      const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const callee = node.expression.getText(sf).split(".").at(-1);
          const keyArg = node.arguments[0];
          if ((callee === "t" || callee === "translateRecentFeature") && keyArg && ts.isStringLiteral(keyArg)) {
            if (!en[keyArg.text]?.trim()) unresolved.push(`${path.relative(root, file)}: ${keyArg.text}`);
            const isAuditedKey = RECENT_FEATURE_TRANSLATION_PREFIXES.some((prefix) => keyArg.text.startsWith(prefix));
            const isLegacyContextMenuKey = keyArg.text.startsWith("contextMenu.") && !featureKeys.includes(keyArg.text);
            if (isAuditedKey && !featureKeys.includes(keyArg.text) && !isLegacyContextMenuKey) {
              unresolved.push(`${path.relative(root, file)}: ${keyArg.text} is not in the explicit feature dictionary`);
            }
            if (isLegacyContextMenuKey && RECENT_FEATURE_LOCALE_CODES.some((locale) => !localeDictionaries[locale][keyArg.text]?.trim())) {
              unresolved.push(`${path.relative(root, file)}: ${keyArg.text} is missing a locale value`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(unresolved).toEqual([]);
  });

  it("finds hardcoded visible copy in inventoried UI source", () => {
    const exceptions = sourceExceptions();
    const offenders: string[] = [];
    const files = inventorySourceFiles().filter((file) =>
      !file.split(path.sep).includes("__tests__") && !/\.(?:test|spec)\.tsx?$/.test(file));
    for (const file of files) {
      for (const finding of scanVisibleLiterals(file, readFileSync(file, "utf8"))) {
        if (exceptions.some((item) =>
          item.file === finding.file &&
          item.property === finding.kind.replace(/^(?:property|attribute):/, "") &&
          (item.value === undefined || item.value === finding.value)
        )) continue;
        offenders.push(`${finding.file}:${finding.line} [${finding.kind}] ${finding.value}`);
      }
    }
    expect(files.length).toBeGreaterThan(100);
    expect(offenders, offenders.slice(0, 20).join("\n")).toEqual([]);
  });

  it("detects representative hardcoded JSX and accessible-name literals", () => {
    const file = path.join(root, "src/components/study-plans/example.tsx");
    const findings = scanVisibleLiterals(file,
      '<button aria-label="Close plan">Close</button><span>{translateRecentFeature("studyPlans.ui.close-plan")}</span>');
    expect(findings.map(({ value }) => value).sort()).toEqual(["Close", "Close plan"].sort());
    expect(findings.every((finding) => finding.file === "src/components/study-plans/example.tsx" && finding.line === 1)).toBe(true);
  });

  it("maps every tab destination to a resolvable localized title", () => {
    const missing = Object.entries(tabContentRegistry).flatMap(([type, entry]) => {
      const key = getTabTitleTranslationKey(type as keyof typeof tabContentRegistry, entry.title);
      return key && en[key] ? [] : [`${type}: ${key ?? "missing title key"}`];
    });
    expect(missing).toEqual([]);
  });

  it("smokes Study Plans, validation, and media screens through the runtime in every locale", async () => {
    const originalState = useSettingsStore.getState();
    const samples = {
      studyPlanLabel: "studyPlans.ui.generate-curriculum.e5c7d8bf",
      accessibilityName: "i18nAudit.ui.flashcard-visual-var0.1beb11e8",
      consent: "mediaCompatibility.consent.videoTranscode",
      progress: "mediaCompatibility.preparing.progressTime",
      storageTitle: "i18nAudit.ui.storage-error.fb70f252",
      storageMessage: "i18nAudit.ui.unable-to-communicate-with-t.7b673de8",
      operationFailed: "studyPlans.ui.operation-failed",
    } as const;
    const validationMessageKey = "study.assessment.error.invalid_prompt_length";
    const homePlan = {
      version: {
        knowledgeAuthority: { kind: "library" },
        nodes: [{ nodeId: "home-node", title: "Home topic", included: true, position: 0, sourceRefIds: [] }],
        prerequisites: [],
      },
      activityByNodeId: {},
    } as unknown as StudyPlanDetail;
    const recoveryErrors = [
      "study_generation.error.no_provider_available",
      "study_plan.error.cost_consent_required",
      "study_plan.error.invalid_topic",
      "study_grading.error.source_evidence_unavailable",
      validationMessageKey,
    ];
    const mediaInspection = {} as MediaInspection;
    const mediaPlan = {
      schemaVersion: 1,
      planId: "plan-smoke",
      documentId: "document-smoke",
      sourceFingerprint: "source-fingerprint",
      inspectionHash: "inspection-hash",
      strategy: "video_transcode",
      confidence: "certain",
      reasons: [],
      subtitlePolicy: "keep",
      requiresConsent: true,
      consentReasons: ["video_codec_unsupported"],
      limitations: [],
      canConvert: true,
    } as unknown as MediaPlaybackPlan;
    const consentState: MediaCompatibilityState = {
      kind: "consent",
      inspection: mediaInspection,
      plan: mediaPlan,
    };
    const preparingState: MediaCompatibilityState = {
      kind: "preparing",
      inspection: mediaInspection,
      plan: mediaPlan,
      job: {
        schemaVersion: 1,
        jobId: "job-smoke",
        documentId: "document-smoke",
        cacheKey: "cache-smoke",
        sequence: 1,
        state: "running",
        phase: "encoding",
        progress: { processedSeconds: 12, durationSeconds: 48 },
        createdAt: "2026-11-13T00:00:00Z",
        updatedAt: "2026-11-13T00:00:00Z",
      } as MediaCompatibilityJobEvent,
    };

    try {
      for (const locale of RECENT_FEATURE_LOCALE_CODES) {
        await loadLocale(locale);
        const currentState = useSettingsStore.getState();
        useSettingsStore.setState({
          settings: {
            ...currentState.settings,
            general: { ...currentState.settings.general, language: locale },
          },
        });

        const dict = explicitFeatureDictionaries[locale];
        expect(t(samples.studyPlanLabel)).toBe(dict[samples.studyPlanLabel]);
        expect(t(samples.accessibilityName, { var0: 2 })).toBe(
          dict[samples.accessibilityName].replace("{var0}", "2"),
        );
        expect(t(samples.consent)).toBe(dict[samples.consent]);
        expect(t(samples.progress, { var0: 12, var1: 48 })).toBe(
          dict[samples.progress].replace("{var0}", "12").replace("{var1}", "48"),
        );
        expect(t(samples.storageTitle)).toBe(dict[samples.storageTitle]);
        expect(t(samples.storageMessage)).toBe(dict[samples.storageMessage]);
        for (const key of recoveryErrors) expect(studyErrorMessageForKey(key)).toBe(dict[key]);
        expect(studyErrorMessage(new Error(validationMessageKey), dict[samples.operationFailed])).toBe(
          dict[validationMessageKey],
        );
        expect(studyErrorMessage(new Error("untranslated native error"), dict[samples.operationFailed])).toBe(
          dict[samples.operationFailed],
        );

        const planHome = render(
          <PlanHomeView
            planDetail={homePlan}
            onContinue={() => undefined}
            onOpenReview={() => undefined}
            onOpenPath={() => undefined}
          />,
        );
        expect(screen.getByText(dict["study_plan.home.reason.no_sources"])).toBeInTheDocument();
        expect(screen.queryByText("study_plan.home.reason.no_sources")).not.toBeInTheDocument();
        planHome.unmount();

        const storageNotice = render(<StudyPlanStateNotice type="storage_failed" />);
        expect(screen.getByRole("alert")).toHaveTextContent(dict[samples.storageTitle]);
        expect(screen.getByRole("alert")).toHaveTextContent(dict[samples.storageMessage]);
        storageNotice.unmount();

        const consentScreen = render(
          <MediaCompatibilityPanel
            state={consentState}
            onConfirmConsent={() => undefined}
            onCancel={() => undefined}
            onRetry={() => undefined}
            onTryOriginal={() => undefined}
          />,
        );
        expect(normalizeDisplayText(screen.getByRole("heading").textContent ?? "")).toBe(
          normalizeDisplayText(dict["mediaCompatibility.consent.title"]),
        );
        expect(screen.getByText(dict[samples.consent])).toBeInTheDocument();
        expect(screen.getByRole("button", { name: dict["mediaCompatibility.consent.tryOriginal"] })).toBeInTheDocument();
        consentScreen.unmount();

        const preparingScreen = render(
          <MediaCompatibilityPanel
            state={preparingState}
            onConfirmConsent={() => undefined}
            onCancel={() => undefined}
            onRetry={() => undefined}
            onTryOriginal={() => undefined}
          />,
        );
        expect(screen.getByText(dict[samples.progress].replace("{var0}", "12").replace("{var1}", "48"))).toBeInTheDocument();
        preparingScreen.unmount();

        const validationScreen = render(
          <QuestionValidationIssues
            issues={[{ path: "prompt", code: "invalid_prompt_length", messageKey: validationMessageKey }]}
          />,
        );
        expect(screen.getByRole("alert")).toHaveTextContent(dict[validationMessageKey]);
        expect(screen.getByRole("alert")).not.toHaveTextContent(validationMessageKey);
        validationScreen.unmount();
        if (locale !== "en") expect(t(samples.studyPlanLabel)).not.toBe(recentFeatureEn[samples.studyPlanLabel]);
      }
    } finally {
      cleanup();
      useSettingsStore.setState(originalState);
    }
  });
});
