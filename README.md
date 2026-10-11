# Leslie · 技术与思考

暖米白背景、克制暖橙点缀与编辑式排版的个人技术博客。浅色默认，支持持久化明暗切换、移动端、文章搜索与分类、阅读目录、代码复制、RSS 和站点地图。

## 运行

需要 Node.js 20+，没有安装依赖步骤。

```bash
npm run build
npm run check
python3 -m http.server 8080 --directory dist
```

## GitHub Pages 部署

1. 在 leslie2046 账号下创建公开仓库 `leslie2046.github.io`。
2. 将这些源文件提交到 main 分支。
3. 在 Settings → Pages → Build and deployment 中选择 GitHub Actions。
4. `.github/workflows/pages.yml` 自动构建、检查并部署到 https://leslie2046.github.io。

## 第一篇文章

首篇文章来自 https://github.com/leslie2046/engineering-notes ，保留 Markdown 原文、封面、性能数据和资料核对链接。文章导入自 2026-10-11 读取的仓库内容，不自动同步。

- 正文：`content/posts/dify-retrieval-performance.md`
- 资料：`content/posts/dify-sources.md`
- 页面结构与文章注册：`scripts/build.mjs`
- 样式：`assets/style.css`
- 交互：`assets/app.js`

更新文章后运行 build 与 check。添加文章时在 build.mjs 注册阅读页、首页索引、RSS 和 sitemap。

Markdown 渲染器为 vendored marked，许可证见 `scripts/vendor/marked-LICENSE.md`。仅渲染仓库内受信任的 Markdown，不接收用户上传的 HTML。
