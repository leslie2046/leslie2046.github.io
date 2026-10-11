import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist');
async function walk(dir) { return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : path.join(dir, entry.name)))).flat(); }
let count = 0;
for (const file of (await walk(root)).filter(file => file.endsWith('.html'))) {
  const html = await readFile(file, 'utf8');
  for (const [, url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (!url.startsWith('/') || url.startsWith('//')) continue;
    const pathname = decodeURI(url.split(/[?#]/)[0]);
    const target = path.join(root, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    await access(target).catch(() => { throw new Error(`Broken internal link: ${path.relative(root, file)} → ${url}`); });
    count++;
  }
}
console.log(`Verified ${count} internal links and assets.`);
