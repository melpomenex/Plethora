/**
 * ESLint rule: no component name rendered as JSX text.
 *
 * A JSX text node whose content is exactly an imported PascalCase identifier,
 * sitting directly beside that very component's element, is never real copy —
 * it is the component's name that leaked out of the tag next to it.
 * `<FloppyDisk className="w-4 h-4" />` followed by a bare `FloppyDisk` renders
 * the word "FloppyDisk" to the user. It shipped in the RSS customization
 * header and in the review card preview's Save button: type-checks fine,
 * renders wrong, and no test caught it.
 *
 * Requiring the element to be a *sibling* is what keeps real copy out of the
 * report. `<Stop /><span>Stop</span>` and `<Download /> Download {format}` are
 * both deliberate English — the icon is not a sibling of the words, or the
 * words carry more copy after them.
 *
 * A file that genuinely wants the word beside its own icon suppresses with
 * `// icon-name-allow: <reason>` on the preceding line (or `{/* … *\/}` inside
 * JSX children), matching the `md3-allow` convention in
 * ./no-hardcoded-chrome-colors.js.
 */

const ALLOW_MARKER = /icon-name-allow/;

/** Icon/component libraries whose PascalCase exports make this bug possible. */
const COMPONENT_MODULE_RE =
  /(@phosphor-icons\/|react-icons\/|lucide-react|@heroicons\/|@radix-ui\/|@fortawesome\/)/;

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow rendering an imported component or icon name as JSX text (it shows up as a literal word in the UI)",
    },
    schema: [],
    messages: {
      iconNameAsText:
        "`{{name}}` is rendered as visible text next to its own icon. That is the component's name, not copy — replace it with a translated label (e.g. t(\"common.save\")). Suppress with `icon-name-allow: <reason>` if the word is intentional.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /** Local names bound to a component-ish import, e.g. `FloppyDisk`. */
    const componentLocals = new Set();
    for (const node of sourceCode.ast.body) {
      if (node.type !== "ImportDeclaration") continue;
      if (!COMPONENT_MODULE_RE.test(node.source.value)) continue;
      for (const spec of node.specifiers) {
        // `import { X as Y }` binds Y; `import X` binds X.
        componentLocals.add((spec.local ?? spec.imported).name);
      }
    }
    if (componentLocals.size === 0) return {};

    const commentsBefore = (node) => {
      const line = node.loc.start.line;
      return sourceCode.getAllComments().some(
        (c) => c.loc.end.line < line && line - c.loc.end.line <= 2 && ALLOW_MARKER.test(c.value),
      );
    };

    /** True for a JSX container holding only a comment (empty expression). */
    const isCommentOnly = (child) =>
      child.type === "JSXExpressionContainer" &&
      child.expression.type === "JSXEmptyExpression";

    const openingName = (element) => {
      const name = element.openingElement?.name;
      if (!name) return null;
      if (name.type === "JSXIdentifier") return name.name;
      if (name.type === "JSXMemberExpression") return name.property?.name ?? null;
      return null;
    };

    return {
      JSXText(node) {
        const raw = node.value.trim();
        // Anything multi-word or not identifier-shaped cannot be a leaked name.
        if (!/^[A-Z][A-Za-z0-9]*$/.test(raw)) return;
        if (!componentLocals.has(raw)) return;
        if (commentsBefore(node)) return;

        // Every sibling must be whitespace, a comment, or this component's own
        // element. A sibling carrying other copy means the word is deliberate.
        const siblings = node.parent?.children ?? [];
        const ownElement = siblings.some(
          (s) => s.type === "JSXElement" && openingName(s) === raw,
        );
        if (!ownElement) return;
        const onlyNoise = siblings.every((s) => {
          if (s === node) return true;
          if (s.type === "JSXText") return s.value.trim() === "";
          if (isCommentOnly(s)) return true;
          return s.type === "JSXElement" && openingName(s) === raw;
        });
        if (!onlyNoise) return;

        context.report({ node, messageId: "iconNameAsText", data: { name: raw } });
      },
    };
  },
};
