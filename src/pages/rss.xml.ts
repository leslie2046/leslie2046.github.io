import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getPosts } from '../lib/posts';
export async function GET(context: APIContext) {
  return rss({ title: 'Leslie · 技术与思考', description: 'AI、开源与软件工程实践笔记', site: context.site!, items: (await getPosts()).map(post => ({ title: post.data.title, description: post.data.description, pubDate: post.data.date, link: `/posts/${post.id}/` })), customData: '<language>zh-CN</language>' });
}
