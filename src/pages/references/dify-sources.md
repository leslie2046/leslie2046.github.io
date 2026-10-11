---
title: 'Dify 检索性能优化：事实核对记录'
layout: '../../layouts/Reference.astro'
---

核对日期：2026-10-09。通过 GitHub REST API 获取 PR 描述、文件差异，以及固定到 PR 最终 head 的完整源码。本文记录用于核对文章；没有在此仓库运行 Dify 后端测试或重现 benchmark。

## PR 身份和时间

- [PR #42673](https://github.com/langgenius/dify/pull/42673)，标题为 `perf(api): reduce knowledge retrieval latency`，作者为 `leslie2046`，已合并。
- 创建时间：2026-09-21 14:30:00 UTC；合并时间：2026-09-24 06:58:16 UTC（北京时间 2026-09-24 14:58:16）。
- 最终 head：`cc722216c197755b09b4fa106b3518ad79769729`；[合并提交](https://github.com/langgenius/dify/commit/74af4f230813a7465e121cd74883585f8819ee2a)：`74af4f230813a7465e121cd74883585f8819ee2a`。这不是 Dify 发布版本号；不能据此声称某一发行版本已经包含它。
- 身份、时间和以下性能表均来自 [PR REST API](https://api.github.com/repos/langgenius/dify/pulls/42673)。最终改动来自 [PR 文件 REST API](https://api.github.com/repos/langgenius/dify/pulls/42673/files?per_page=100) 和下列固定提交的源码。

## 性能数据及解释边界

PR 作者报告的测试条件：**相同 dataset 和 query，100 次串行检索请求**。

| 指标 | 优化前 | 优化后 | PR 报告的降幅 |
|---|---:|---:|---:|
| 平均延迟 | 709.68 ms | 410.13 ms | 42.2% |
| P50 | 418.99 ms | 236.95 ms | 43.4% |
| P95 | 1188.90 ms | 312.34 ms | 73.7% |
| P99 | 4871.85 ms | 4827.02 ms | 0.9% |
| 最大延迟 | 6649.63 ms | 4873.20 ms | 26.7% |
| 超过 500 ms 的请求 | 30 / 100 | 4 / 100 | 86.7% |
| 超过 1 秒的请求 | 12 / 100 | 4 / 100 | 66.7% |

以上是 PR 描述中的观测结果，不是本文重新测试，也不是所有 Dify 部署的性能保证。PR 描述没有给出足以复现 benchmark 的完整硬件、部署拓扑、模型、向量库、数据集大小、请求脚本、优化前基线 SHA、原始逐请求记录、预热和缓存命中情况，不能自行补齐这些条件。该测试也不支持并发吞吐或不同 query 的效果结论。

PR 描述另报告：解码后的 provider payload 约 1.56 MB；重复 Pydantic 校验 P50 为 64.39 ms、P95 为 219.43 ms、P99 为 292.51 ms、最大 341.35 ms。这是校验环节的测量，不能等同于整个检索请求延迟。

P99 几乎没有改善，仍有约 4.5–4.9 秒的异常长请求。PR 作者认为这些异常“似乎”独立于 provider 解析，尚需调查；不能把这一推测写成已经证实的根因，也不能宣称长尾已经解决。

## 最终源码：四个要点

### 1. 进程内缓存解析好的 provider 声明

源码：[plugin_service.py](https://github.com/langgenius/dify/blob/cc722216c197755b09b4fa106b3518ad79769729/api/core/plugin/plugin_service.py)。

- 使用类级 `OrderedDict`，最多 **8** 个条目，每个进程拥有自己的缓存。
- key 为 `(payload 字节长度, SHA-256 digest)`。输入是从 Redis 取到的 payload，包括压缩格式；**先查本地缓存，未命中才解压和 Pydantic 校验**。不能写成“每次仍先解压再查缓存”。字符串按 UTF-8 转字节。
- 缓存值为 provider 声明对象组成的 tuple。tuple 不代表内部 Pydantic 对象深度不可变；源码要求消费者把共享声明视为只读。
- 命中时通过 pop 后重新插入更新顺序；超过 8 个时 `popitem(last=False)` 淘汰最久未使用条目。
- `threading.Lock` 保护缓存容器的读写和 LRU 顺序；**耗时解析在锁外**。两个并发首次请求可能都解析同一 payload，不能声称它实现了 single-flight 或保证只解析一次。
- 原 Redis 数据源的租户/generation key、TTL 配置和压缩机制仍保留；本地缓存读取前仍获取相应 Redis payload。内容变化会使用新的内容 key，并非新增本地 TTL 或主动清空所有旧条目。
- Redis 缓存写入成功后，也把相同 payload 对应的解析结果放入本地缓存。

### 2. 避免修改共享 provider 对象

源码：[provider_configuration.py](https://github.com/langgenius/dify/blob/cc722216c197755b09b4fa106b3518ad79769729/api/core/entities/provider_configuration.py)。

特定配置下补充 `PREDEFINED_MODEL` 能力时，原实现直接 append 到 provider 的 `configurate_methods`；最终版本改为 `model_copy(update=...)`，并构造新的列表，避免污染缓存中的共享 provider 声明。不能只写“共享对象只读”，还应说明这个实际修改点。这是最终 diff 中存在、PR 描述的三项 changes 未单列的改动。

### 3. 先读 query embedding 缓存，再构造模型

源码：[vector_factory.py](https://github.com/langgenius/dify/blob/cc722216c197755b09b4fa106b3518ad79769729/api/core/rag/datasource/vdb/vector_factory.py)、[cached_embedding.py](https://github.com/langgenius/dify/blob/cc722216c197755b09b4fa106b3518ad79769729/api/core/rag/embedding/cached_embedding.py)。

- `_LazyEmbeddings.embed_query()` 在 dataset 的 provider/model 均存在时，先调用 `CacheEmbedding.get_cached_query_embedding(provider, model_name, text)`。
- 命中直接返回向量，不调用 `_ensure()`，因此跳过 `ModelManager.for_tenant()`、模型实例解析和 embedding 模型调用；未命中继续原模型路径。
- 原有 Redis key 格式保留为 `provider_modelName_queryHash`，queryHash 使用 `helper.generate_text_hash(text)`。**没有新增 dataset ID 或 tenant ID 到该 key，也没有在这个入口把 dataset provider 别名规范化。** 若 dataset provider 表示和最终模型实例 provider 不一致，前置查询可能 miss；后续原路径仍使用实际模型实例 provider 查询。
- Redis 缓存值使用 Base64 编码的 NumPy float 向量。命中调用 `expire(..., 600)`；新向量写入 `setex(..., 600, ...)`，所以沿用 600 秒缓存时间并在命中时续期。
- 这次前置读取只加在文本 `embed_query()`；不能写成所有 embedding、多模态和异步入口都新增该捷径。

### 4. Rerank 复用已绑定模型的 schema

源码：[rerank_model.py](https://github.com/langgenius/dify/blob/cc722216c197755b09b4fa106b3518ad79769729/api/core/rag/rerank/rerank_model.py)。

移除能力检查阶段的额外 `ModelManager.for_tenant()` 和 `check_model_support_vision(...)`，改为已有 `rerank_model_instance.get_model_schema()`，检测 `ModelFeature.VISION in (model_schema.features or [])`。这里只能说“避免重复模型/提供商解析”，不能说“不再进行任何 schema 获取或外部调用”。文本、视觉 rerank 路径选择仍基于 vision capability。

## 测试证据和措辞

PR 描述报告 Ruff lint、Ruff formatting 和 Python syntax compilation 通过；也明确说明本地缺少 `uv` 和后端依赖，**未能执行定向 pytest**。这里没有重新执行这些检查，所以文章应区分“添加了测试”“PR 作者报告的检查结果”和“实际执行测试”。

最终 diff 增加或修改的回归覆盖可在固定提交源码中核实：

- [test_plugin_service.py](https://github.com/langgenius/dify/blob/cc722216c197755b09b4fa106b3518ad79769729/api/tests/unit_tests/services/plugin/test_plugin_service.py)：相同 payload 复用、不同 payload 分别解析、容量上限。容量测试只检查大小，不能宣称已经验证全部并发行为或所有 LRU 淘汰次序。
- [test_provider_configuration.py](https://github.com/langgenius/dify/blob/cc722216c197755b09b4fa106b3518ad79769729/api/tests/unit_tests/core/test_provider_configuration.py)：复制 provider 后不修改原列表。
- [test_vector_factory.py](https://github.com/langgenius/dify/blob/cc722216c197755b09b4fa106b3518ad79769729/api/tests/unit_tests/core/rag/datasource/vdb/test_vector_factory.py)：query cache 命中跳过模型解析。
- [test_embedding_service.py](https://github.com/langgenius/dify/blob/cc722216c197755b09b4fa106b3518ad79769729/api/tests/unit_tests/core/rag/embedding/test_embedding_service.py)：无模型实例读取 query cache，key 和 600 秒续期。
- [test_reranker.py](https://github.com/langgenius/dify/blob/cc722216c197755b09b4fa106b3518ad79769729/api/tests/unit_tests/core/rag/rerank/test_reranker.py)：复用绑定模型 schema 和 vision 路径。

