/**
 * Agent tool registry (design D25, task 8.1).
 *
 * The registry IS the allowlist: the loop executes a tool call only when
 * `getAgentTool(name)` resolves it — anything else (hallucinated names,
 * "delete_all_cards", …) is answered with a typed rejected result the model
 * can see, and nothing outside the registry can ever run.
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

/** Tool descriptions for the static system instruction (stable order). */
export function agentToolCatalogText(): string {
  return [...registry.values()]
    .map((tool) => `- ${tool.name} (${tool.category}): ${tool.description}`)
    .join("\n");
}

/** Test-only: reset to the default tool set. */
export function resetAgentToolRegistry(): void {
  registry.clear();
  for (const tool of READ_ONLY_TOOLS) register(tool);
  for (const tool of PROPOSAL_TOOLS) register(tool);
}
