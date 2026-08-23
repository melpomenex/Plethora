import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const pageSchema = z.object({
  title: z.string(),
  description: z.string(),
  noindex: z.boolean().optional(),
  owner: z.literal('E').default('E'),
  claimIds: z.array(z.string()).default([]),
  path: z.string().optional(),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: pageSchema,
});

const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z
      .enum([
        'start-here',
        'capture-and-import',
        'read-and-listen',
        'understand-and-extract',
        'organize-and-connect',
        'remember-and-review',
        'scheduling-and-algorithms',
        'language-learning',
        'ai-and-models',
        'rss-and-podcasts',
        'platforms-and-devices',
        'settings-privacy-troubleshooting',
      ])
      .default('start-here'),
    order: z.number().default(999),
    published: z.boolean().default(true),
    noindex: z.boolean().optional(),
    featureStatus: z.enum(['shipping', 'experimental', 'planned', 'deprecated']).default('shipping'),
    platforms: z.array(z.string()).default(['all']),
    readingTimeMinutes: z.number().optional(),
    lastReviewed: z.string().optional(),
    keywords: z.array(z.string()).default([]),
    aliases: z.array(z.string()).default([]),
    relatedDocs: z.array(z.string()).default([]),
    owner: z.literal('E').default('E'),
    claimIds: z.array(z.string()).default([]),
    sourcePath: z.string().optional(),
    redirectAliases: z.array(z.string()).default([]),
  }),
});

export const collections = { pages, docs };
