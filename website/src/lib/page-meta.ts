import { getEntry } from 'astro:content';

export async function pageMeta(slug: string) {
  const entry = await getEntry('pages', slug);
  if (!entry) {
    throw new Error(`Missing commercial page content: ${slug}`);
  }
  return {
    title: `${entry.data.title} — Plethora`,
    description: entry.data.description,
    noindex: entry.data.noindex,
  };
}
