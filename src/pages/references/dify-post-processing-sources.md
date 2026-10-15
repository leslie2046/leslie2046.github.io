---
layout: '../../layouts/Reference.astro'
title: 'Dify 知识检索性能优化（二）：来源与实现核对'
article: '/posts/dify-retrieval-post-processing/'
---

核对日期：2026 年 10 月 15 日。文章依据 issue、PR 说明、最终 PR head 的源码与回归测试整理，没有另行运行 Dify benchmark 或后端测试。

## 状态与版本

- [Issue #43664](https://github.com/langgenius/dify/issues/43664)：作者 leslie2046，已关闭，关闭原因为 completed。
- [PR #43665](https://github.com/langgenius/dify/pull/43665)：作者 leslie2046，已合并；合并时间为 2026-10-15 02:52:34 UTC，即北京时间 10:52:34。
- 最终 PR head：`e041c4c9d40886202a77c6c73aa423458c54f7da`。
- [合并提交](https://github.com/langgenius/dify/commit/e67479bd8c5a03b5dbf74d42cf9dd64c1209bf6e)：`e67479bd8c5a03b5dbf74d42cf9dd64c1209bf6e`。
- main 合并状态不能直接说明某个发行版本已经包含此改动。

## 生产代码

1. [weight_rerank.py](https://github.com/langgenius/dify/blob/e041c4c9d40886202a77c6c73aa423458c54f7da/api/core/rag/rerank/weight_rerank.py)：`_calculate_cosine` 先检查 `score` 键；仅无分数文档需要查询向量；先读取已有缓存，再在未命中时初始化模型；查询向量为局部变量，单次调用内复用。
2. [dataset_retrieval.py](https://github.com/langgenius/dify/blob/e041c4c9d40886202a77c6c73aa423458c54f7da/api/core/rag/retrieval/dataset_retrieval.py)：引用组装通过现有 `retrieval_session` 调用仓库读取，传入请求租户和 `available_datasets_ids`；原有授权检查、内容签名与来源组装逻辑继续保留。
3. [retrieval_source_repository.py](https://github.com/langgenius/dify/blob/e041c4c9d40886202a77c6c73aa423458c54f7da/api/repositories/knowledge/retrieval_source_repository.py)：加载 id、tenant_id、dataset_id、name、data_source_type、doc_metadata 六字段；限制租户、知识库与文档范围；ID 去重；空输入提前返回；未加载列设置 `raiseload=True`。

`raiseload` 约束的是此次读取未加载的列属性，不应扩大表述为“引用过程中任何数据库访问都会被禁止”。

## 回归测试

- [test_reranker.py](https://github.com/langgenius/dify/blob/e041c4c9d40886202a77c6c73aa423458c54f7da/api/tests/unit_tests/core/rag/rerank/test_reranker.py)：空输入、已有分数（含零分与负分）、混合输入、向量缓存命中及未命中、单次调用只解析一次查询向量。
- [test_retrieval_source_query.py](https://github.com/langgenius/dify/blob/e041c4c9d40886202a77c6c73aa423458c54f7da/api/tests/unit_tests/core/rag/retrieval/test_retrieval_source_query.py)：真实 KnowledgeRetrievalRequest；两分段引用同一文档；100 万字符的 data_source_info 与 error；引用内容和元数据断言；仅一次文档查询；范围过滤、去重、空输入及 raiseload 行为。

测试使用 SQLite session 检查 SQL 与 ORM 行为，不能代替 PostgreSQL 性能压测。

## 验证记录的范围

PR 说明记录：基于上游 `1ed388d8657c2c9c0f1fb2234845bdc56cb18ae9` rebase，本地验证提交为 `729900285d`，在独立 Python 3.12 环境通过 `uv run --project api` 执行，206 项相关单元测试通过；五文件 Ruff 与格式检查、三份生产文件定向 Pyrefly 以及 `git diff --check` 通过。

这不是对最终 head 本地重跑全部测试的声明。[PR 审查记录](https://github.com/langgenius/dify/pull/43665)显示，最终 head `e041c4c9` 于 2026-10-15 02:47:04 UTC 获得 APPROVED。

全仓库 lint/type-check 和 CI 负责的集成测试未在 PR 所述本地验证中运行。本文制作时只运行博客的类型检查、构建与链接检查。

## Tempo 数据与归因限制

数据来自 issue 与 PR 的同一组初始本地观测：Dify 1.17.1 Docker、PostgreSQL、四个内置知识库、Chatflow 混合检索；比较的两次运行均已有其他检索优化。

| 位置 | 优化前 ms | 优化后 ms |
| --- | ---: | ---: |
| 加权评分后处理 A | 170.71 | 2.91 |
| 加权评分后处理 B | 157.58 | 5.01 |
| 引用文档 SQL | 71.45 | 0.90 |

这是单次 trace 观测，不是受控 benchmark。引用查询不同文档数由 3 变为 1，因此 SQL 全部差异不能归因于列投影；无 main 生产延迟 benchmark，不计算端到端加速比，不外推 P95 或吞吐容量。
