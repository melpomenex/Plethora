/**
 * ESLint rule: no hardcoded chrome colors in migrated Material paths.
 *
 * Flags hex color literals inside `className` (and template-literal class
 * strings) for files listed in MIGRATED_PATHS — the surfaces that have been
 * migrated onto the Material token system. Suppress a legitimate
 * feature-specific value with `// md3-allow: <reason>` on the preceding
 * line. See docs/design-system.md.
 */

const MIGRATED_PATHS = [
  "src/components/md3/",
  "src/components/common/UI.tsx",
  "src/components/common/Modal.tsx",
  "src/components/common/ConfirmDialog.tsx",
  "src/components/common/Toast.tsx",
  "src/components/common/ReaderTTSControls.tsx",
  "src/components/review/RatingButtons.tsx",
  "src/components/review/ReviewCard.tsx",
  "src/components/viewer/selectionInteraction/SelectionActionBar.tsx",
  "src/components/import/ImportDialog.tsx",
];

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
const ALLOW_MARKER = /md3-allow/;

/** The copy-pasted primary-button Tailwind recipe predating md3/Button. */
const LEGACY_BUTTON_RE = /bg-primary\s+text-primary-foreground\s+hover:bg-primary\/90/;

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow hardcoded colors and the legacy primary-button recipe in migrated Material UI paths",
    },
    schema: [],
    messages: {
      hardcodedColor:
        "Hardcoded color in migrated UI: use a semantic token (docs/design-system.md). Suppress with `// md3-allow: <reason>` if feature-specific.",
      legacyButton:
        "Legacy primary-button recipe: use md3 Button variant=\"filled\" (src/components/md3/Button.tsx).",
    },
  },

  create(context) {
    const filename = context.filename ?? "";
    if (!MIGRATED_PATHS.some((p) => filename.includes(p))) {
      return {};
    }

    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const allComments = sourceCode.getAllComments();
    const commentsBefore = (node) => {
      const line = node.loc.start.line;
      return allComments.some(
        (c) => c.loc.end.line < line && line - c.loc.end.line <= 2 && ALLOW_MARKER.test(c.value),
      );
    };

    function checkString(node) {
      if (node.type !== "Literal" && node.type !== "TemplateLiteral") return;
      if (commentsBefore(node)) return;
      const raw = node.type === "Literal" ? String(node.value ?? "") : node.quasis.map((q) => q.value.raw).join("");
      if (!raw.includes("class") && !raw.includes("#") && !LEGACY_BUTTON_RE.test(raw)) return;
      if (HEX_RE.test(raw)) {
        context.report({ node, messageId: "hardcodedColor" });
      }
      if (LEGACY_BUTTON_RE.test(raw)) {
        context.report({ node, messageId: "legacyButton" });
      }
    }

    return {
      JSXAttribute(node) {
        const name = node.name?.name ?? node.name?.value;
        if (name === "className" || name === "class") {
          checkString(node.value);
        }
      },
    };
  },
};
