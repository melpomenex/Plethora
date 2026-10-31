/**
 * Agent tool registry (design D25, task 8.1).
 *
 * The registry IS the allowlist: the loop executes a tool call only when
 * `getAgentTool(name)` resolves it — anything else (hallucinated names,
 * "delete_all_cards", …) is answered with a typed rejected result the model
 * can see, and nothing outside the registry can ever run.
 *
 * The registry is also the single source of truth for the model-facing
 * catalog: each tool's `parameters` descriptor feeds `agentToolCatalogText()`
 * (and the future `buildAgentToolSchemas()` seam). The runtime validators
 * remain the only enforcement.
 */

import type { AgentToolDefinition } from "./tools/types";
import { READ_ONLY_TOOLS } from "./tools/readonly";
import { PROPOSAL_TOOLS } from "./tools/proposals";

const registry = new Map<string, AgentToolDefinition<never>>();

function register(tool: AgentToolDefinition<any>): void {
  registry.set(tool.name, tool as AgentToolDefinition<never>);
}

for (const tool of READ_ONLY_TOOLS) register(tool);
for (const tool of PROPOSAL_TOOLS) register(tool);

/** Test seam: replace the whole registry (restores the default set after). */
export function registerAgentTool(tool: AgentToolDefinition<any>): void {
  register(tool);
}

export function getAgentTool(name: string): AgentToolDefinition<never> | undefined {
  return registry.get(name);
}

/** Frozen allowlist for prompt building + tests. */
export function listAgentToolNames(): readonly string[] {
  return Object.freeze([...registry.keys()]);
}

/** One catalog line for a tool: name (category): description + args lines. */
function toolCatalogLine(tool: AgentToolDefinition<any>): string {
  const lines = [`- ${tool.name} (${tool.category}): ${tool.description}`];
  for (const arg of tool.parameters) {
    const required = arg.required ? "req" : "opt";
    const bounds: string[] = [];
    if (arg.type === "enum" && arg.enum) bounds.push(`one of [${arg.enum.join("|")}]`);
    if (arg.maxLength !== undefined) bounds.push(`≤${arg.maxLength}`);
    if (arg.maxItems !== undefined) bounds.push(`≤${arg.maxItems}`);
    if (arg.min !== undefined || arg.max !== undefined) {
      bounds.push(`${arg.min ?? "-∞"}..${arg.max ?? "+∞"}`);
    }
    const suffix = bounds.length > 0 ? ` (${bounds.join("; ")})` : "";
    lines.push(`    args: ${arg.name}: ${arg.type} (${required})${suffix}`);
  }
  return lines.join("\n");
}

/** Tool descriptions for the static system instruction (stable order). */
export function agentToolCatalogText(): string {
  return [...registry.values()]
    .map((tool) => toolCatalogLine(tool))
    .join("\n");
}

/** Estimated catalog size (chars) — used by the loop fit check. */
export function agentToolCatalogCharCount(): number {
  return agentToolCatalogText().length;
}

/**
 * Reserved seam for future provider-verified native tool schemas. Declared
 * but unused until a provider capability is wire-verified (design §13); the
 * runtime validators and the JSON catalog remain the only enforcement today.
 */
export function buildAgentToolSchemas(): Record<string, unknown> {
  const schemas: Record<string, unknown> = {};
  for (const tool of registry.values()) {
    schemas[tool.name] = {
      type: "object",
      properties: Object.fromEntries(
        tool.parameters.map((arg) => [
          arg.name,
          {
            type:
              arg.type === "string[]"
                ? "array"
                : arg.type === "enum"
                  ? "string"
                  : arg.type,
            ...(arg.type === "string[]" ? { items: { type: "string" } } : {}),
            ...(arg.enum ? { enum: [...arg.enum] } : {}),
            ...(arg.maxLength !== undefined ? { maxLength: arg.maxLength } : {}),
            ...(arg.maxItems !== undefined ? { maxItems: arg.maxItems } : {}),
            ...(arg.min !== undefined ? { minimum: arg.min } : {}),
            ...(arg.max !== undefined ? { maximum: arg.max } : {}),
            description: arg.description,
          },
        ])
      ),
      required: tool.parameters.filter((arg) => arg.required).map((arg) => arg.name),
      additionalProperties: false,
    };
  }
  return schemas;
}

/** Test-only: reset to the default tool set. */
export function resetAgentToolRegistry(): void {
  registry.clear();
  for (const tool of READ_ONLY_TOOLS) register(tool);
  for (const tool of PROPOSAL_TOOLS) register(tool);
}
