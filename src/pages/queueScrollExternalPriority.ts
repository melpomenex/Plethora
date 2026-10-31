/** Order feed items within their existing type slots, preserving the old order for ties. */
export function orderFeedPriorities<T extends {
  type: string;
  rssItem?: { id: string };
  podcastEpisode?: { id: string };
}>(items: T[], priorities: Readonly<Record<string, number>>): T[] {
  const result = [...items];
  for (const [type, kind, idOf] of [
    ["rss", "rss-article", (item: T) => item.rssItem?.id],
    ["podcast", "podcast-episode", (item: T) => item.podcastEpisode?.id],
  ] as const) {
    const slots = result.flatMap((item, index) => item.type === type ? [index] : []);
    const sorted = slots.map((index) => result[index]).sort((a, b) =>
      (priorities[`${kind}:${idOf(b)}`] ?? 50) - (priorities[`${kind}:${idOf(a)}`] ?? 50));
    slots.forEach((index, position) => { result[index] = sorted[position]; });
  }
  return result;
}
