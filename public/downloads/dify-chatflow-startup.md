# 让 Dify Chatflow 更快开始：一次启动阶段的性能优化

![Dify Chatflow 启动优化：请求、供应商元数据与运行时的复用示意](https://leslie2046.github.io/images/dify-startup.svg)

封面流程为概念示意；数值来自 PR 中报告的一组环境样本，测量对象是 `workflow_started`，不是完整回答耗时。

- 作者：[Leslie / leslie2046](https://github.com/leslie2046)
- 写作日期：2026-10-11
- 相关贡献：[Dify PR #36773](https://github.com/langgenius/dify/pull/36773)，2026-06-11 合并到上游 `main`
- 本文以 PR 最终代码为依据，不据此推断具体 Dify 发行版本是否包含该改动。

## 1. 工作流开始之前，已经做了多少准备？

讨论 AI 应用的延迟时，我们经常先想到模型推理。但一次 Chatflow 请求在真正调用模型之前，还要准备供应商配置、凭据、模型声明和运行时对象。这些工作没有直接产生回答，却影响流程开始的速度。

我提交的 [PR #36773](https://github.com/langgenius/dify/pull/36773) 聚焦这条启动路径：减少重复的供应商与模型解析，在同一个请求中复用已有信息，并改善供应商元数据的缓存路径。

这里的“复用”分为两个层次。第一层是在当前请求中，避免已经做过的查询再次发生；第二层是在当前进程中，复用已经解析的供应商声明。两者的作用域、更新方式和正确性要求并不相同。

## 2. 凭据拿到了，模型信息也一起留下

启动逻辑需要获取模型凭据，也需要检查模型是否存在、状态是否可用。原来的 `fetch_model_config()` 在初始化模型实例后，还会通过供应商配置再次查询模型信息。

但 `DifyCredentialsProvider.fetch()` 为了得到凭据，已经查过对应模型，也完成了模型状态校验。这份经过校验的模型信息可以用于后续检查。

改动为凭据提供器增加了 `provider_model_cache`，与凭据缓存一样，用 `(provider_name, model_name)` 作为键。在成功取得凭据后，保存对应的 `ModelWithProviderEntity`；后续 `fetch_model_config()` 优先读取这份信息。

简化后的路径如下，**这是逻辑示意，不是可直接执行的源码**：

```text
获取凭据
  → 查询供应商与模型
  → 校验模型状态
  → 保存凭据，同时保存已校验的模型信息

准备模型配置
  → 初始化模型实例
  → 优先复用刚才的模型信息
  → 没有可复用结果时，继续原来的查询与校验
```

这不是把所有模型查找替换成全局缓存。只有实际使用 `DifyCredentialsProvider` 且已有对应结果时，才走这条复用路径；其他情况保留回退逻辑。

缓存写入和读取模型对象时都使用深拷贝，减少调用方修改返回对象后污染缓存的风险。凭据提供器的作用域也很关键：源码明确提醒，长期复用同一个实例，可能在配置或 API key 更新后返回旧凭据。因此，这种设计适合随请求使用，不能随意扩展为长期共享的对象。[固定版本实现：model_access.py](https://github.com/langgenius/dify/blob/d0edd1893e1713b305a7196d368fd859a9400253/api/core/app/llm/model_access.py)

## 3. 已经有供应商声明，就不要再取一次目录

第二部分改动发生在 `ProviderConfiguration`。这个对象本身已经包含供应商声明，也可以绑定上层组装好的模型运行时。嵌套的模型查询如果重新解析一遍供应商或运行时，就会产生重复准备工作。

PR 将几处查找调整为优先使用这些已有对象：

- 绑定运行时时，同时记录当前供应商声明。
- 查找供应商声明时优先使用缓存；在没有绑定缓存且声明里也没有模型列表时，才通过 factory 补取。
- 构造模型类型实例时复用已绑定的运行时和供应商声明。
- 查询模型 schema 时优先使用已绑定的运行时，并通过供应商标识调用其接口。

这些细节有一个共同目标：让嵌套调用继续使用当前请求已经组装的上下文，而不是每深入一层都重新准备一套对象。

改动还减少了模型列表构建中不必要的工作。系统供应商路径可以按指定模型提前过滤；自定义供应商路径则先判断目标是否属于预定义模型，再决定是否过滤预定义列表。后者保留了自定义模型场景的处理，不能简单理解为“所有情况下只查一个名字”。

供应商配置方法的原始值也被保存在实例内，用于后续判断；这并不意味着文件中原有的模块级记录已经全部删除。[固定版本实现：provider_configuration.py](https://github.com/langgenius/dify/blob/d0edd1893e1713b305a7196d368fd859a9400253/api/core/entities/provider_configuration.py)

## 4. Redis 命中之后，再省掉重复反序列化

供应商目录的 Redis 缓存解决了重复获取元数据的问题，但读取 JSON 后，仍要将它校验、转换为应用可用的对象。

这次改动在 `PluginService` 中加入了进程内镜像，按租户保存已解析的供应商实体。每个条目同时记录 generation、过期时间和供应商列表，过期判断使用 `time.monotonic()`。

读取路径大致是：

```text
读取租户的 Redis generation
  → 进程内条目 generation 一致，而且没有过期
    → 返回供应商实体的深拷贝
  → 否则读取对应 generation 的 Redis 元数据
    → 命中：校验 JSON，填充进程内镜像
    → 未命中：从插件服务获取，再填充缓存
```

**进程内命中仍然需要读取 Redis generation。** 省下的是后续元数据读取、JSON 校验等工作，并不是每次请求都完全绕过 Redis。

缓存返回深拷贝，也意味着对象复制仍有成本。进程镜像是各个 worker 自己维护的，不能当作跨进程共享内存。其有效期沿用 `PLUGIN_MODEL_PROVIDERS_CACHE_TTL`；配置值不大于零时，进程内条目不会保留。[固定版本缓存实现：plugin_service.py](https://github.com/langgenius/dify/blob/d0edd1893e1713b305a7196d368fd859a9400253/api/core/plugin/plugin_service.py)

### generation 如何帮助失效？

只清理当前进程的镜像，不足以让其他 worker 知道供应商目录变了。PR 增加了租户级 generation 标记，并让 Redis 元数据键包含 generation。

执行失效时，当前进程先移除自己的镜像，再通过 Redis pipeline 删除旧格式缓存键、递增 generation。其他 worker 随后读到新的 generation，会拒绝复用旧代的进程条目。

读取兼容也有边界：generation 为零时，会同时尝试带 generation 的键与旧格式键；实现用 `MGET` 批量读取这些候选键。

这里使用的是 `pipeline(transaction=False)`。它减少命令往返，不等同于原子事务。最终代码在插件服务返回结果之后才再次读取 generation，因此也不能宣称解决了所有并发刷新与失效竞态。本文的核对记录保留了这个实现边界，读者可以沿固定版本代码继续检查。[generation 与失效实现](https://github.com/langgenius/dify/blob/d0edd1893e1713b305a7196d368fd859a9400253/api/core/plugin/plugin_service.py#L262-L303)

### 空结果并没有被新增为负缓存

从插件服务新获取的供应商列表如果为空，代码会直接返回，不继续写入这两层缓存。因此，这次改动不能被描述为“所有结果，包括空列表，都缓存起来”。

另一个不同的情况是：Redis 中已经存在可解析的空列表 JSON。读取逻辑可以将它解析为空元组，并把它当作缓存命中。区分“新获取的空结果不写入”和“已有空列表可以读出”，才能准确理解行为。[读取与填充逻辑](https://github.com/langgenius/dify/blob/d0edd1893e1713b305a7196d368fd859a9400253/api/core/plugin/plugin_service.py#L187-L303)

## 5. 性能数字说明了什么？

PR 描述报告了作者环境中的一组样本：

| 指标 | 优化前 | 优化后 | 报告降幅 |
| --- | ---: | ---: | ---: |
| `workflow_started` 平均耗时 | 0.3226 s | 0.1893 s | 41.3% |
| `workflow_started` 中位数 | 0.2585 s | 0.1540 s | 40.4% |

按表格换算，平均耗时减少约 **133.3 ms**，中位数减少约 **104.5 ms**。[数据来源：PR 描述](https://github.com/langgenius/dify/pull/36773)

这组结果支持启动阶段在该环境样本中有改善，但需要明确几个限制：

- 指标是 `workflow_started`。公开说明没有提供足以确认其精确计时起点的测量脚本，不能自行等同于首字延迟（TTFT）或完整回答时间。
- PR 未公开样本数、完整硬件与部署拓扑、缓存预热流程、优化前基线 SHA 和逐请求记录，本文没有重新运行这组 benchmark。
- 没有 P95、P99、并发吞吐或不同模型配置的数据，不能推导长尾和高并发场景的收益。

减少启动准备工作，对交互体验有价值；具体能节省多少，仍要结合自己的流程、插件数量、缓存状态与部署方式测量。

## 6. 性能优化的验证，不能只看“命中了”

PR 的测试改动覆盖了多条正确性路径，包括复用模型信息、复用绑定的运行时与供应商声明，以及供应商缓存的读取、独立对象返回和 generation 失效。测试文件能说明这些行为有对应的回归断言，不能代替重新运行测试的结果。

GitHub 合并记录显示该 PR 通过合并队列进入 `main`，页面记录了 31 项检查通过。本文未在本地运行 Dify 后端测试，也没有复现性能实验。[合并记录](https://github.com/langgenius/dify/pull/36773)；[测试与事实核对记录](https://leslie2046.github.io/references/dify-startup-sources/)

如果要在自己的部署中验证，我会将重复请求与冷启动分开，同时检查模型配置更新、插件变化、多 worker 场景和 Redis 异常后的行为。这些是后续验证建议，不是 PR 已公开完成的 benchmark 项目。

这次改动带给我的工程思考是：性能问题不总要靠增加一层缓存解决。先检查当前请求已经拥有了什么，减少重复解析和对象组装；确实需要跨请求缓存时，再把作用域、复制成本和失效路径一起设计清楚。

## 相关链接

- [Dify PR #36773](https://github.com/langgenius/dify/pull/36773)
- [完整代码差异](https://github.com/langgenius/dify/pull/36773/files)
- [合并提交 c4a8d79](https://github.com/langgenius/dify/commit/c4a8d79be99a44c11d478b9f1c3584d0b082bcba)
- [事实核对记录](https://leslie2046.github.io/references/dify-startup-sources/)
- [另一篇实践：Dify 知识检索性能优化](https://leslie2046.github.io/posts/dify-retrieval-performance/)
