import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const pageSchema = z.object({
  title: z.string(),
  description: z.string(),
  noindex: z.boolean().optional(),
  owner: z.literal('E'),
  claimIds: z.array(z.string()),
  path: z.string(),
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
    noindex: z.boolean().optional(),
    owner: z.literal('E'),
    claimIds: z.array(z.string()),
    published: z.boolean(),
  }),
});

export const collections = { pages, docs };
