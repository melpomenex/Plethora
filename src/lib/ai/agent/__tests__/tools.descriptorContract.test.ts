/**
 * Descriptor ↔ validator agreement (change 4.1): for every registered tool,
 * generate invalid inputs from its `parameters` descriptor ONLY (unknown key,
 * wrong type, over-limit, out-of-enum, missing required) and assert the
 * runtime validator rejects each. This machine-proves that the model-facing
 * contract and the enforcing validators cannot drift.
 */

import { describe, expect, it } from "vitest";
import { isFailedOutcome } from "../../schemas/common";
import {
  listAgentToolNames,
  getAgentTool,
  resetAgentToolRegistry,
} from "../registry";
import type { AgentToolArgDescriptor } from "../tools/types";

function invalidInputsFor(toolName: string, parameters: readonly AgentToolArgDescriptor[]): Array<{
  label: string;
  input: unknown;
}> {
  const invalid: Array<{ label: string; input: unknown }> = [];
  const base: Record<string, unknown> = {};
  for (const arg of parameters) {
    if (arg.required) {
      if (arg.type === "enum" && arg.enum?.length) base[arg.name] = arg.enum[0];
      else if (arg.type === "number") base[arg.name] = 1;
      else if (arg.type === "boolean") base[arg.name] = true;
      else if (arg.type === "string[]") base[arg.name] = ["x"];
      else if (arg.type === "object" && toolName === "propose_flashcard_batch") {
        base[arg.name] = [{ question: "Q", answer: "A" }];
      } else base[arg.name] = "value";
    }
  }

  // Unknown keys are always rejected (even for zero-parameter tools).
  invalid.push({ label: "unknown key", input: { ...base, __bogus__: 1 } });

  for (const arg of parameters) {
    // Wrong type.
    invalid.push({
      label: `${arg.name}: wrong type`,
      input: { ...base, [arg.name]: arg.type === "string" ? 42 : "not-a-number" },
    });
    if (arg.required) {
      invalid.push({
        label: `${arg.name}: missing required`,
        input: { ...base, [arg.name]: undefined },
      });
    }
    if (arg.type === "enum" && arg.enum?.length) {
      invalid.push({
        label: `${arg.name}: out of enum`,
        input: { ...base, [arg.name]: "not-an-enum-value" },
      });
    }
    if (arg.maxLength !== undefined) {
      invalid.push({
        label: `${arg.name}: over length`,
        input: { ...base, [arg.name]: "x".repeat(arg.maxLength + 1) },
      });
    }
    if (arg.maxItems !== undefined) {
      invalid.push({
        label: `${arg.name}: over items`,
        input: { ...base, [arg.name]: Array.from({ length: arg.maxItems + 1 }, () => "x") },
      });
    }
    if (arg.type === "number" && arg.max !== undefined && !arg.clamped) {
      invalid.push({
        label: `${arg.name}: above max`,
        input: { ...base, [arg.name]: arg.max + 1 },
      });
    }
  }
  return invalid;
}

describe("tool descriptor ↔ validator contract", () => {
  afterEach(() => resetAgentToolRegistry());

  it("every registered tool declares parameters (compile-time presence)", () => {
    for (const name of listAgentToolNames()) {
      const tool = getAgentTool(name);
      expect(tool).toBeDefined();
      expect(Array.isArray(tool!.parameters)).toBe(true);
    }
  });

  it("descriptor-invalid inputs are rejected by every runtime validator", () => {
    for (const name of listAgentToolNames()) {
      const tool = getAgentTool(name)!;
      const cases = invalidInputsFor(name, tool.parameters);
      expect(cases.length, `${name} should have invalid-input cases`).toBeGreaterThan(0);
      for (const { label, input } of cases) {
        const outcome = tool.validate(input);
        expect(isFailedOutcome(outcome), `${name} ${label}`).toBe(true);
      }
    }
  });

  it("valid inputs built from descriptors pass validation", () => {
    for (const name of listAgentToolNames()) {
      const tool = getAgentTool(name)!;
      const input: Record<string, unknown> = {};
      for (const arg of tool.parameters) {
        if (!arg.required) continue;
        if (arg.type === "enum" && arg.enum?.length) input[arg.name] = arg.enum[0];
        else if (arg.type === "number") input[arg.name] = arg.min ?? 1;
        else if (arg.type === "boolean") input[arg.name] = true;
        else if (arg.type === "string[]") input[arg.name] = ["x"];
        else if (arg.type === "object" && name === "propose_flashcard_batch") {
          input[arg.name] = [{ question: "Q", answer: "A" }];
        } else if (name === "propose_cloze" && arg.name === "text") {
          input[arg.name] = "A sample {{c1::deletion}} sentence.";
        } else input[arg.name] = "value";
      }
      const outcome = tool.validate(input);
      expect(outcome.ok, `${name} should accept descriptor-valid input`).toBe(true);
    }
  });
});
