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
source: https://github.com/langgenius/dify/pull/42673
draft: false
---
```

封面可选。公共图片放入 public/images/，正文使用 /images/文件名。

## GitHub Pages

.github/workflows/pages.yml 在 main 更新时运行 npm ci、完整 verify，然后发布 dist。Settings → Pages 的部署来源选择 GitHub Actions。

站点：https://leslie2046.github.io 。用户主页仓库不需要 base 前缀。如迁移域名，更新 astro.config.mjs 中 site 及 public/robots.txt。

## 内容来源

首篇记录 Dify 知识检索性能优化实践，相关贡献为 Dify PR #42673，写作日期 2026-10-09。保留正文、封面、性能数据、测试边界及事实核对记录。

- 文章：src/content/posts/dify-retrieval-performance.md
- 核对资料：src/pages/references/dify-sources.md
- 页面：src/pages/；共享布局：src/layouts/
- 主题和响应式样式：src/styles/global.css

正文仅使用受信任的仓库内容。构建不依赖运行时 API、外部字体或外部图床。

## 技术报告

技术首页分别展示工程文章与技术报告，报告汇总页为 /reports/。在文章 frontmatter 中设置 kind: report 即可归入报告模块；未设置时默认为普通文章。报告继续使用 /posts/文件名/ 地址，并进入 RSS 和站点地图。

报告正文应保留测试日期、条件、指标单位与结论范围。公开下载的数据需去除凭据、内部地址和其他非公开信息；CSV 汇总值与逐请求原始记录应明确区分。

## 生活片段

导航“技术”展示技术文章，“生活”展示 section: life 的文章。未指定 section 时默认归入技术版块。

在 src/content/posts/ 添加 Markdown，例如：

```yaml
---
title: '周末的一段散步'
description: '记下路上的一点小事。'
date: 2026-10-11
section: life
category: 日常
tags: [生活]
---

在这里写正文。
```

生活文章无需 source、封面或核对资料。发布后自动进入生活列表、RSS 和站点地图。用 draft: true 暂存草稿。

## 项目板块

一级导航“项目”指向 /projects/，采用响应式宫格展示项目简介与 GitHub 仓库链接。
在 src/data/projects.ts 中添加、编辑或调整项目顺序即可更新卡片。介绍依据公开 README 编写，不在构建或浏览时调用 GitHub API。
