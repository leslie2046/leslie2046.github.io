# Leslie · 技术与思考

暖米白、克制暖橙、编辑式排版的个人技术博客。默认浅色，支持持久化明暗主题、移动端、文章搜索与分类、阅读目录、代码复制、RSS、站点地图及 404 页面。

技术栈：Astro 7、TypeScript 6、Tailwind CSS 4。文章通过 Astro Content Collections 校验并静态生成，依赖由 package-lock.json 锁定。

## 本地开发

需要 Node.js 22.12+（推荐 Node.js 24）。

```bash
npm ci
npm run dev
```

访问 http://127.0.0.1:4321。

```bash
npm run verify
npm run preview
```

verify 运行类型检查、生产构建及生成站点的内部链接和资源检查。

## 新增文章

在 src/content/posts/ 添加 Markdown，文件名即文章地址。列表、RSS 和站点地图自动生成。draft: true 的文章不会发布。

```yaml
---
title: '文章标题'
description: '文章摘要'
date: 2026-10-11
tags: [AI, 工程]
category: 工程实践
cover: /images/cover.png
source: https://github.com/leslie2046/engineering-notes
draft: false
---
```

封面可选。公共图片放入 public/images/，正文使用 /images/文件名。

## GitHub Pages

.github/workflows/pages.yml 在 main 更新时运行 npm ci、完整 verify，然后发布 dist。Settings → Pages 的部署来源选择 GitHub Actions。

站点：https://leslie2046.github.io 。用户主页仓库不需要 base 前缀。如迁移域名，更新 astro.config.mjs 中 site 及 public/robots.txt。

## 内容来源

首篇来自 https://github.com/leslie2046/engineering-notes ，固定于提交 f8280286c25074a9ae09dd1430181e9f24f0a3b0，写作日期 2026-10-09。保留正文、封面、性能数据、测试边界及事实核对记录，不自动同步。

- 文章：src/content/posts/dify-retrieval-performance.md
- 核对资料：src/pages/references/dify-sources.md
- 页面：src/pages/；共享布局：src/layouts/
- 主题和响应式样式：src/styles/global.css

正文仅使用受信任的仓库内容。构建不依赖运行时 API、外部字体或外部图床。
