/** Reserve prompt overhead before allocating any explicit source bodies. */
export function scopedBodyTokenBudget(options: {
  promptBudgetTokens: number;
  instructions?: string;
  history?: readonly { content: string }[];
  userPrompt?: string;
}): number {
  const text = [options.instructions ?? "", options.userPrompt ?? "", ...(options.history ?? []).map((message) => message.content)].join("\n");
  const remaining = Math.floor(options.promptBudgetTokens) - Math.ceil(text.length / 4) - 128;
  if (!Number.isFinite(remaining) || remaining < 64) throw new Error("The selected scope cannot fit alongside the prompt and conversation. Select fewer sections or start a new conversation.");
  return remaining;
}

/** Equal shares, with unused space redistributed in source order. */
export function budgetScopedBodies(bodies: readonly { label: string; text: string; selection?: boolean }[], maxTokens: number, trimRatio = 1): { content: string; truncated: boolean } {
  const maxChars = Math.floor(maxTokens * 4 * trimRatio);
  const separator = "\n\n---\n\n";
  const marker = "\n[Selected body truncated to the context budget]";
  const headers = bodies.map((body) => `${body.selection ? "Selected text" : "Section"}: ${body.label}\n[${body.selection ? "Selection" : "Focused"}]\n`);
  // Reserve the disclosure before allocation; it must fit too.
  const available = maxChars - headers.reduce((sum, value) => sum + value.length, 0) - Math.max(0, bodies.length - 1) * separator.length - bodies.length * marker.length;
  const minimum = bodies.map((body) => Math.min(96, body.text.trim().length));
  if (!bodies.length || minimum.some((length) => !length) || available < minimum.reduce((sum, length) => sum + length, 0)) {
    throw new Error("The selected sections cannot each retain a readable body. Select fewer sections or increase the context budget.");
  }
  const lengths = [...minimum];
  let remaining = available - lengths.reduce((sum, length) => sum + length, 0);
  while (remaining > 0) {
    const active = bodies.map((body, index) => ({ index, length: body.text.trim().length })).filter((body) => lengths[body.index] < body.length);
    if (!active.length) break;
    const share = Math.max(1, Math.floor(remaining / active.length));
    for (const body of active) {
      const added = Math.min(share, body.length - lengths[body.index], remaining);
      lengths[body.index] += added;
      remaining -= added;
    }
  }
  let truncated = false;
  const content = bodies.map((body, index) => {
    const text = body.text.trim();
    const omitted = lengths[index] < text.length;
    truncated ||= omitted;
    return `${headers[index]}${text.slice(0, lengths[index]).trimEnd()}${omitted ? marker : ""}`;
  }).join(separator);
  return { content, truncated };
}
