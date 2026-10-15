---
title: 'Dify 知识检索性能优化（二）：让评分与引用组装少做无用功'
description: '从 Grafana Tempo 的检索追踪出发，按需准备查询向量、精简引用文档查询，并用回归测试守住评分、排序和元数据。'
date: 2026-10-15
section: tech
category: 工程实践
tags: [Dify, RAG, 性能优化, PostgreSQL, 开源]
cover: /images/dify-retrieval-post-processing.svg
source: https://github.com/langgenius/dify/pull/43665
references: /references/dify-post-processing-sources/
download: /downloads/dify-retrieval-post-processing.md
---

**系列文章**：[（一）缓存与初始化优化](/posts/dify-retrieval-performance/) · **（二）评分与引用组装优化**

![检索后处理优化示意：已有分数直接复用，缺少分数时按需准备查询向量；引用组装只读取所需文档字段。](/images/dify-retrieval-post-processing.svg)

上一篇记录了供应商声明解析、查询向量缓存和模型信息复用的优化。这一次，我继续沿着知识检索的调用链向后看：文档已经召回，为什么评分和引用组装还要花不少时间？

在一个自部署 Dify 1.17.1 的 Chatflow 中，我使用 Grafana Tempo 查看四个内置知识库的混合检索追踪，发现两处可以避免的工作：**已有语义分数时仍准备 embedding 模型与查询向量；构造来源引用时仍加载完整文档记录。**

这成为 [Issue #43664](https://github.com/langgenius/dify/issues/43664) 和 [PR #43665](https://github.com/langgenius/dify/pull/43665) 的起点。PR 已于 **2026 年 10 月 15 日合并到上游 main**。

## 1. 从追踪里找到后处理开销

当时的部署使用 Docker、PostgreSQL，Chatflow 配置了四个内置知识库，混合检索中涉及加权评分和模型重排。

追踪中的检索分支已经存在时间重叠，因此这次工作的重点是召回后的处理成本。最初的本地实验记录如下：

| 观测位置 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 加权评分后处理，分支 A | 170.71 ms | 2.91 ms |
| 加权评分后处理，分支 B | 157.58 ms | 5.01 ms |
| 来源引用的文档 SQL | 71.45 ms | 0.90 ms |

这些是**本地修改过的 1.17.1 部署中的单次 trace 观测**，两次运行都已经包含其他检索优化。其中，引用查询返回的不同文档数还从 3 个变为 1 个，不能把 SQL 的全部耗时差异都归因于精简字段。

这组数据提供了排查方向，但不能代替受控 benchmark，也不能据此推算整条请求的 P95、并发容量或 main 分支的生产收益。[观测条件与原始记录](https://github.com/langgenius/dify/issues/43664)

## 2. 已经有分数，就不必先准备查询向量

第一处改动位于 `WeightRerankRunner._calculate_cosine()`。

原来的执行顺序是：先获取 `ModelManager`、构造 embedding 模型实例并解析查询向量，再遍历文档。遍历时，如果文档元数据中已经带有 `score`，又会直接复用这个分数。

也就是说，当所有文档都已经有分数时，前面的向量准备没有被用到。

改动把准备工作推迟到**首次遇到没有分数的文档**时：

1. 有 `score` 的文档，直接沿用其分数。
2. 遇到无分数文档，先读取已有的查询向量缓存。
3. 缓存未命中，才初始化 embedding 模型并走原有计算路径。
4. 本次调用后续的无分数文档复用同一个查询向量。

下面是控制流的简化示意，省略具体接口参数和余弦计算细节：

```python
query_vector = None

for document in documents:
    if has_score(document):
        scores.append(existing_score(document))
        continue

    if query_vector is None:
        query_vector = read_existing_cache(query)
        if query_vector is None:
            query_vector = initialize_model_and_embed(query)

    scores.append(cosine(query_vector, document.vector))
```

最终实现的几种路径可以直接区分：

| 输入情况 | 需要进行的工作 |
| --- | --- |
| 空文档列表 | 不准备 embedding，也不读查询向量缓存 |
| 全部文档已有分数 | 直接沿用分数，不准备 embedding |
| 部分文档无分数，查询向量缓存命中 | 读取并复用向量，跳过模型初始化 |
| 部分文档无分数，缓存未命中 | 初始化模型，解析向量，本次调用内复用 |

这里有一个容易忽略的边界：**分数为 0，不等于没有分数。** 实现检查的是元数据中是否存在 `score`，而不是对分数做真假判断。回归测试也覆盖了 `0.0` 和负分数，避免优化时误入重新计算路径。

这部分没有增加新的持久缓存，也没有修改评分公式；它改变的是准备查询向量的时机。[固定版本源码](https://github.com/langgenius/dify/blob/e041c4c9d40886202a77c6c73aa423458c54f7da/api/core/rag/rerank/weight_rerank.py)

## 3. 组装来源引用，只读取需要的字段

第二处改动在知识检索结果的来源引用组装阶段。

原来通过 ORM 查询整个 `Document`。但构造引用用不到文档处理信息、错误文本等字段，读取这些内容会增加数据传输和对象加载的工作。

PR 新增了 `get_retrieval_source_documents()`，将文档查询集中到一个明确的读取入口。它接收调用方传入的 `Session`，只加载六个字段：

| 字段 | 用途 |
| --- | --- |
| `id` | 建立文档映射、填写引用文档 ID |
| `tenant_id` | 保留租户归属信息 |
| `dataset_id` | 保留知识库归属信息 |
| `name` | 引用标题与文档名称 |
| `data_source_type` | 来源类型 |
| `doc_metadata` | 文档元数据 |

查询同时按租户、可用知识库范围和文档 ID 过滤；知识库 ID、文档 ID 经过去重，空输入直接返回空结果。

引用中的分段正文、分数等其他信息，继续由原有的分段处理与引用组装逻辑提供。精简的是文档读取范围，原有的引用输出仍需保持一致。[仓库读取实现](https://github.com/langgenius/dify/blob/e041c4c9d40886202a77c6c73aa423458c54f7da/api/repositories/knowledge/retrieval_source_repository.py)

### 避免把省下的字段变成 N+1 查询

只设置按需加载还不够。以后组装代码若访问了一个未加载字段，ORM 可能再发一次 SQL；当返回多篇文档时，就可能形成不易察觉的逐文档查询。

因此，这里使用 `load_only(..., raiseload=True)`。对本次查询未加载的列属性，后续访问会触发异常，让依赖变化显式暴露出来，而不是悄悄补查。

对应测试创建了两个分段，引用同一篇文档；文档的 `data_source_info` 和 `error` 各放入约 100 万字符。测试监听 SQL，核对引用的标题、正文、元数据和顺序，确认文档查询只有一次，也没有选取这些无关字段。

另一组测试核对租户与知识库过滤、重复 ID、空输入，并确认访问未加载字段会触发 `raiseload` 异常。这些检查约束了“少读字段”的效果，也保护了后续维护时的查询行为。

## 4. 怎样确认优化没有改变结果

对检索链路来说，少花时间只是其中一个目标。还要确认文档分数、返回顺序、引用内容和元数据没有随着执行顺序变化而出错。

这次新增或调整的回归覆盖主要集中在：

- 空输入和全部已有分数的输入，不触发向量准备。
- 混合输入在缓存命中、未命中时，都得到预期分数，查询向量只解析一次。
- 零分、负分保留原值。
- 引用结果的标题、内容、元数据和顺序符合预期。
- 文档读取范围正确，组装引用不产生额外的文档懒加载查询。

PR 说明记录了 **206 项相关单元测试通过**，覆盖 reranker、dataset retrieval、citation query 和 data post-processor 套件；同时记录了 Ruff、格式检查、三份生产代码的定向 Pyrefly 检查与 diff 检查通过。

这些本地验证对应提交 `729900285d`，使用独立 Python 3.12 环境，通过 `uv run --project api` 执行。最终获批的 PR head 为 `e041c4c9`。全仓库 lint/type-check 与 CI 负责的集成测试未在该本地验证中运行；本文也没有重新执行 Dify 后端测试。[验证与源码核对记录](/references/dify-post-processing-sources/)

## 5. 两次优化，共同的问题是什么

第一篇减少的是供应商声明的重复解析，以及缓存命中前的模型初始化；这一篇继续减少评分与来源引用组装中的准备和读取工作。

它们共同指向一个问题：**当前结果真正需要哪些工作，哪些只是因为执行得太早、读取得太多而发生？**

对于类似的 RAG 系统，我会沿着请求链路继续检查三个位置：已有结果能否复用、昂贵操作能否延后、数据库读取是否与返回内容匹配。每做一处调整，就用对应的结果与查询行为测试固定边界。

下一步值得做的是在固定版本、固定输入和相同返回文档数的条件下复测，分别观察缓存命中与未命中、多知识库并发、端到端分位数和错误率。当前 PR 已合并，但尚没有 main 分支的生产性能 benchmark；具体发行版本是否包含该改动，需要另行核对。

## 系列与相关链接

- [（一）一次 P95 延迟下降 73.7% 的实践](/posts/dify-retrieval-performance/)
- [Issue #43664：问题与初始观测](https://github.com/langgenius/dify/issues/43664)
- [PR #43665：实现、验证与讨论](https://github.com/langgenius/dify/pull/43665)
- [合并提交 e67479bd](https://github.com/langgenius/dify/commit/e67479bd8c5a03b5dbf74d42cf9dd64c1209bf6e)
- [固定版本源码与资料核对](/references/dify-post-processing-sources/)
