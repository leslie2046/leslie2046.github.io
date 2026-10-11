---
title: 'Dify Chatflow 启动优化：事实核对记录'
layout: '../../layouts/Reference.astro'
article: '/posts/dify-chatflow-startup/'
---

核对日期：2026-10-11。核对材料为 GitHub REST API 的 PR 描述、全部 7 个文件的 patch、review comments，以及固定到最终 head 的完整源码。本文没有运行 Dify 后端测试，也没有重现性能测试。

## PR 身份与性能数据

- [PR #36773](https://github.com/langgenius/dify/pull/36773)，标题为 `perf(api): reduce workflow startup latency for chatflow`，作者 `leslie2046`，已合并。
- 创建时间：2026-05-28 07:41:10 UTC；合并时间：2026-06-11 07:19:58 UTC（北京时间 2026-06-11 15:19:58）。
- 最终 head：`d0edd1893e1713b305a7196d368fd859a9400253`；[合并提交](https://github.com/langgenius/dify/commit/c4a8d79be99a44c11d478b9f1c3584d0b082bcba)：`c4a8d79be99a44c11d478b9f1c3584d0b082bcba`。这两个 SHA 不能当成 Dify 发行版本号。
- PR 共 20 个提交，修改 7 个文件，新增 615 行、删除 94 行。身份与时间来自 [PR API](https://api.github.com/repos/langgenius/dify/pulls/36773)，变更范围来自 [文件 API](https://api.github.com/repos/langgenius/dify/pulls/36773/files?per_page=100)。

PR 作者提供的是其环境中的一组性能样本：

| 指标 | 优化前 | 优化后 | PR 报告的降幅 |
|---|---:|---:|---:|
| workflow_started 平均值 | 0.3226 s | 0.1893 s | 41.3% |
| workflow_started 中位数 | 0.2585 s | 0.1540 s | 40.4% |

数值来自 [PR 描述](https://github.com/langgenius/dify/pull/36773)。平均值相差 133.3 ms，中位数相差 104.5 ms。PR 没有提供样本数、测试脚本、完整计时定义、机器配置、部署拓扑、优化前基线 SHA、模型、workflow、预热策略或缓存命中率。因此，不能将这些数字扩展为所有部署的性能保证，也不能将 `workflow_started` 指标写成首 token 延迟、模型生成耗时、完整请求延迟或并发吞吐改善。

## 最终源码：请求范围内的复用

### 1. 复用已经验证过的 provider model

源码：[model_access.py](https://github.com/langgenius/dify/blob/d0edd1893e1713b305a7196d368fd859a9400253/api/core/app/llm/model_access.py)。

- `DifyCredentialsProvider.fetch()` 先获取模型、执行 `raise_for_status()`，再取得凭据。只有成功取得凭据后，才以 `(provider_name, model_name)` 保存凭据和 provider model 的深拷贝。
- `fetch_model_config()` 先调用凭据 provider。对于 `DifyCredentialsProvider`，接着取已验证模型的深拷贝，省去再次调用 `get_provider_model()` 和再次执行状态校验。
- 对其他 `CredentialsProvider` 实现，或没有缓存模型的情形，保留原有查找与状态校验分支。模型实例初始化、model schema 查找和实例参数设置仍然执行。
- 实例文档明确要求按请求、workflow run 或其他有限范围创建；不能跨不相关调用长期持有，否则凭据轮换等配置变更可能使缓存过时。这里缓存的不是生成结果。
- `build_dify_model_access()` 在最终源码中让两个 adapter 共享 provider manager，但这个函数并非本 PR 新增；本次新增的是 provider model 缓存和后续检查复用，不能把所有上下文代码都归为本次改动。

### 2. 复用配置携带的 schema 和绑定 runtime

源码：[provider_configuration.py](https://github.com/langgenius/dify/blob/d0edd1893e1713b305a7196d368fd859a9400253/api/core/entities/provider_configuration.py#L88)。

- `bind_model_runtime()` 绑定 runtime，同时将已有 `self.provider` 保存为 `_cached_provider_schema`。
- `_get_provider_schema()` 在未缓存时优先使用有 models 的 `self.provider`；否则延迟调用 factory 获取 schema，之后复用结果。绑定路径已经缓存 provider，即使 models 为空也不重复走 factory。
- `get_model_type_instance()` 使用已有 provider schema 和绑定 runtime 构造模型类型实例；`get_model_schema()` 直接交给该 runtime，传递完整的 provider id、模型类型、模型名以及 `credentials or {}`。
- 没有绑定 runtime 时仍有创建 model assembly 的后备路径，不能声称全部调用永久消除了 runtime 构造。
- `_original_provider_configurate_methods` 在 validator 修改 `configurate_methods` 之前保存实例级 tuple；相关判断改为读取这个快照。原模块级字典仍在源码中，不能写成全局字典已经删除。

### 3. 指定模型时尽早过滤

源码：[模型列表路径](https://github.com/langgenius/dify/blob/d0edd1893e1713b305a7196d368fd859a9400253/api/core/entities/provider_configuration.py#L1544)。

- 系统 provider 路径把 `model` 参数传给 helper，对预定义模型和可定制 provider 的 restricted models 提前过滤；后者可以避免为不相关 restricted model 查询 schema。
- 自定义 provider 的预定义列表只有在目标确实属于请求类型下的预定义模型时才提前过滤，源码使用 `requested_predefined_model` 判断；不能概括为任何名称都无条件只遍历目标模型。
- 自定义模型配置分支原本就有名称过滤，本 PR 没有新引入它。模型状态、配额、权限、负载均衡状态、去重和排序仍然保留。

## 最终源码：进程缓存与 generation

源码：[plugin_service.py](https://github.com/langgenius/dify/blob/d0edd1893e1713b305a7196d368fd859a9400253/api/core/plugin/plugin_service.py#L129)。

1. 每次读取先从 Redis 获取租户的 generation。marker 不存在时按 `0` 处理；读取异常或非法值时返回 `None`，不走本地/Redis provider payload 命中路径。
2. 进程级类字典按租户存储 `(generation, expires_at, providers)`。generation 必须相等，且 `time.monotonic()` 未超过过期时间；返回数据为 provider entity 的深拷贝。
3. 本地未命中时通过 `MGET` 读取 generation 对应的 payload key；只有 generation 为 `0` 时额外读取旧版租户 key。读到 JSON 后使用 Pydantic 校验，并填充进程缓存。
4. 两层缓存未命中后调用 plugin daemon。非空结果再次读取 generation，再写入进程缓存和 Redis `SETEX`。本地 TTL 使用同一个 `PLUGIN_MODEL_PROVIDERS_CACHE_TTL` 配置；TTL 不大于 0 时本地不存储。
5. 本地命中仍然需要一次 Redis generation `GET`，并进行深拷贝。省掉的是 provider payload 的读取、反序列化/校验以及 daemon 发现，不是完全零网络、零复制。

### 空结果不新增负缓存

`fetch_plugin_model_providers()` 在 daemon 返回空列表时直接返回空 tuple，不进入 generation 读取和两层缓存写入。它不会把“当前没有 provider”长期记住。这一点由 [第 288–302 行](https://github.com/langgenius/dify/blob/d0edd1893e1713b305a7196d368fd859a9400253/api/core/plugin/plugin_service.py#L288)直接确认。

需区分：如果 Redis 已有合法 JSON payload `[]`，读取路径能够把它解析为有效的空 tuple；`cached_providers is not None` 会把它视为命中。这不代表 daemon 新抓到的空结果也会写入负缓存。

### 失效与并发边界

失效方法先删除当前进程的租户缓存，再使用 `pipeline(transaction=False)` 批量执行旧版 key 的 `DEL` 和 generation marker 的 `INCR`。其他 worker 下次读取时发现 generation 不匹配，就淘汰本地旧数据。旧 generation 的 payload key 不逐个删除，依靠 TTL 过期。[失效源码](https://github.com/langgenius/dify/blob/d0edd1893e1713b305a7196d368fd859a9400253/api/core/plugin/plugin_service.py#L264)

Review 分别要求 [使用 pipeline](https://github.com/langgenius/dify/pull/36773#discussion_r3373703742) 和 [使用 MGET](https://github.com/langgenius/dify/pull/36773#discussion_r3373714822)，最终代码均已采用；review 原文来自 [comments API](https://api.github.com/repos/langgenius/dify/pulls/36773/comments?per_page=100)。

`transaction=False` 明确关闭事务，不能称为原子事务、强一致失效或一次完成全部原子操作。Redis 失效失败会记录警告并继续；这时其他进程未必看到 generation 增长。代码也没有 single-flight 或锁保护 daemon 抓取：缓存未命中请求可能先拿到旧数据，在失效发生后读到新 generation，再把旧数据写到新 generation。因此，generation 检查解决的是观察到版本变化后的旧缓存复用问题，不能宣称消除所有并发回写竞态。这一竞态是根据源码执行顺序的分析，没有在本文实验复现。

## 测试实际覆盖范围

以下结论来自最终 patch 与固定 head 的测试源码，描述的是测试断言范围，不表示本文执行了这些测试：

- [LLM node 测试](https://github.com/langgenius/dify/blob/d0edd1893e1713b305a7196d368fd859a9400253/api/tests/unit_tests/core/workflow/nodes/llm/test_node.py)：新增用例验证 provider model 查找及状态校验各调用一次。
- [ProviderConfiguration 测试](https://github.com/langgenius/dify/blob/d0edd1893e1713b305a7196d368fd859a9400253/api/tests/unit_tests/core/entities/test_entities_provider_configuration.py)：验证绑定 runtime 后不构造 factory/assembly，直接调用 runtime schema 方法；覆盖系统预定义模型、系统 restricted model、自定义 provider 预定义模型的指定名称过滤，以及连续查询复用 schema。
- [PluginService 测试](https://github.com/langgenius/dify/blob/d0edd1893e1713b305a7196d368fd859a9400253/api/tests/unit_tests/services/plugin/test_plugin_service.py)：覆盖 Redis 缓存命中、非法 payload 删除并回源、generation/MGET 读取失败、写入失败、默认 client 创建；新增进程缓存复用并返回独立对象、pipeline 调用/失败容忍、本地清空、预置旧 generation 被拒绝。
- [Runtime adapter 测试](https://github.com/langgenius/dify/blob/d0edd1893e1713b305a7196d368fd859a9400253/api/tests/unit_tests/core/plugin/test_model_runtime_adapter.py)：本 PR 为 fake Redis 增加 `mget`，增加自动清理进程缓存 fixture，并调整相关 mock。租户隔离、跨 runtime TTL 缓存等测试在此前已存在，不能全称为本次新增。

以上大多使用 mock 或 fake Redis，不足以证明真实多 worker 并发失效、Redis 故障下的强一致性、计时指标改善、首 token 改善或吞吐提升。新增 patch 没有针对 TTL 到期、空 daemon 结果不缓存、抓取与失效交错竞态的专门测试。PR checklist 自述运行了 lint/type-check 等检查，但不能据此声称本文重新运行了上游检查。
