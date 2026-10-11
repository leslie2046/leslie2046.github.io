import { getCollection } from 'astro:content';
export const getPosts = async () => (await getCollection('posts', ({ data }) => !data.draft))
  .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
export const formatDate = (date: Date) => date.toISOString().slice(0, 10).replaceAll('-', '.');
export const readingTime = (body = '') => Math.max(1, Math.ceil(body.length / 500));
