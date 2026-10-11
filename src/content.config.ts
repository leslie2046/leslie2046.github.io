import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(), description: z.string(), date: z.coerce.date(),
    tags: z.array(z.string()), category: z.string(),
    section: z.enum(['tech', 'life']).default('tech'),
    kind: z.enum(['article', 'report']).default('article'),
    cover: z.string().optional(), source: z.url().optional(),
    references: z.string().optional(), download: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});
export const collections = { posts };
