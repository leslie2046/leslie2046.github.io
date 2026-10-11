---
title: 'Xinference 工程实践：事实核对记录'
layout: '../../layouts/Reference.astro'
article: '/posts/xinference-model-serving/'
---

核对日期：2026-10-11。材料为两个 PR 的 GitHub REST API 描述、全部文件 patch、review comments、reviews，以及固定到各自最终 head 的完整变更文件源码。本文没有运行 Xinference 测试、启动真实模型或重现 Supervisor 主进程重启。

## PR 身份与时间

两个 PR 作者均为 `leslie2046`，均已合并。以下时间明确区分 UTC 与北京时间，SHA 为提交标识，不是发行版本号。

| 项目 | PR #4731 | PR #5250 |
|---|---|---|
| 标题 | FEAT: reconnect and reconstrcut model replicas after restart supervisor | FIX: worker reconnection after supervisor restart |
| 创建时间（UTC） | 2026-03-27 04:22:40 | 2026-07-27 15:27:58 |
| 合并时间（UTC） | 2026-04-06 16:10:43 | 2026-07-28 14:28:47 |
| 合并时间（北京时间） | 2026-04-07 00:10:43 | 2026-07-28 22:28:47 |
| 最终 head | `d82b3f6e12a1d788aa1de432ede3e9dc5528d1f3` | `04b23212797ca2ae53ec8c942b9484a98206e339` |
| merge commit | `7d5227f0af25141912fc930ccaabb910979fedc8` | `93d1b8f0c69fc782dc580e39682ad85bdc76b643` |
| 变更文件数 | 8 | 2 |

身份与时间：[4731 PR API](https://api.github.com/repos/xorbitsai/inference/pulls/4731)、[5250 PR API](https://api.github.com/repos/xorbitsai/inference/pulls/5250)。变更范围：[4731 文件 API](https://api.github.com/repos/xorbitsai/inference/pulls/4731/files?per_page=100)、[5250 文件 API](https://api.github.com/repos/xorbitsai/inference/pulls/5250/files?per_page=100)。

## #4731 的问题与实现

[PR #4731](https://github.com/xorbitsai/inference/pull/4731) 关联 [issue #2402](https://github.com/xorbitsai/inference/issues/2402)。PR 描述的问题是 Supervisor 重启之后，用户原本需要重启 Worker 并重新部署模型；方案是 Worker 自动重新连接，上传自己的状态与模型副本状态。该描述说明变更意图，具体范围仍需以最终代码与测试为准。

### Worker 保留 endpoint，并回放副本快照

固定源码：[worker.py](https://github.com/xorbitsai/inference/blob/d82b3f6e12a1d788aa1de432ede3e9dc5528d1f3/xinference/core/worker.py#L455)。

- `get_supervisor_ref()` 原先只在 Worker 没有模型时调用 `add_worker()`；变更后可以带着现存副本状态重新注册。
- `_get_running_replica_states()` 遍历本地 `_model_uid_to_model_spec`，结合 launch args 构造状态，包含副本 UID、`n_worker`、`shard`、模型名、版本、能力和创建时间等。模型启动路径新增 `launch_ts`，避免每次回放都重置创建时间。
- 快照对可回放条目标记 `READY`。它不是一次真实推理健康探测，也不能据此证明每个正在加载或故障的模型都可正常响应。
- 带有 `xavier_config` 的条目跳过回放，源码明确说明 Xavier 恢复仍依赖 Supervisor 拥有的协调状态。
- `report_status()` 的调用失败路径清除缓存引用，再调用 `get_supervisor_ref(add_worker=True)`，重新注册后重试状态上报。
- `_clear_supervisor_refs()` 一并清除 Supervisor、StatusGuard、EventCollector、CacheTracker 与 ProgressTracker 的引用。只清 Supervisor 引用会留下指向旧 Supervisor 的辅助 actor 引用。

[CLI](https://github.com/xorbitsai/inference/blob/d82b3f6e12a1d788aa1de432ede3e9dc5528d1f3/xinference/deploy/cmdline.py#L359) 把用户指定的 HTTP `endpoint` 和当时查询到的内部 actor address 都传给 Worker；[Worker 启动链](https://github.com/xorbitsai/inference/blob/d82b3f6e12a1d788aa1de432ede3e9dc5528d1f3/xinference/deploy/worker.py) 继续传递 endpoint。重新解析旧 actor address 失败时，Worker 通过 `asyncio.to_thread()` 调用 REST client 查询新的内部地址，再尝试取得 actor 引用。健康连接不必反复做此查询；endpoint 为 `None` 时，刷新方法直接返回。[本地集群](https://github.com/xorbitsai/inference/blob/d82b3f6e12a1d788aa1de432ede3e9dc5528d1f3/xinference/deploy/local.py#L62) 和测试集群传入的正是 `None`。

### Supervisor 重建路由与单 Worker 副本详情

固定源码：[supervisor.py](https://github.com/xorbitsai/inference/blob/d82b3f6e12a1d788aa1de432ede3e9dc5528d1f3/xinference/core/supervisor.py#L138)。

- `add_worker()` 去掉了“地址已存在则断言失败”的限制，并接受 `replica_states`。旧 `replica_model_uids` 输入通过 normalize 方法转换成单 Worker、shard 0 的简化状态。
- 回放先移除该 Worker 的旧映射，再按新快照重建副本到 Worker、模型到副本等内存索引。移除一个 Worker 时尽量保留其他 Worker 的映射；只有没有剩余副本时才清理模型级索引。
- 副本 UID 解析失败、负副本索引以及以 `-rank0` 结尾的内部 UID 被跳过。非法 `n_worker` 或负 shard 使用默认值，`n_worker > 1` 且 shard 越界的条目被跳过。
- 多 Worker 副本有独立的 `shard → Worker` 映射，最终按 shard 排序保存为 tuple。这样恢复顺序与上报到达顺序解耦；读取模型、描述、状态等路径也同步兼容 tuple。
- StatusGuard 重建实例名称、版本、能力、创建时间与副本状态，但明确跳过 `n_worker > 1`。所以“多 Worker 副本路由恢复”与“全部部署形式的详情恢复”是两种不同结论。此 PR 不覆盖所有分布式模型的完整协调状态。

这一过程重建的是 Supervisor 的内存元数据与路由，并不通过重新执行模型启动来重载权重。适用前提是相应 Worker 和本地模型状态仍存在。此处不是模型进程崩溃、Worker 丢失或整个集群失去状态后的通用灾难恢复方案。

## #5250 补上的恢复入口

固定源码：[5250 最终 worker.py](https://github.com/xorbitsai/inference/blob/04b23212797ca2ae53ec8c942b9484a98206e339/xinference/core/worker.py#L3930)。

到了 #5250 的基线，周期任务先调用轻量 `heartbeat()`，成功后才在相应轮次调用 `report_status()`。心跳使用 `get_supervisor_ref(add_worker=False)`，避免在轻量存活探测中执行完整注册。如果缓存引用非空，该调用会直接返回缓存；引用已经指向旧地址时，心跳失败可能让后面的状态上报无法执行，已有的注册与副本重建逻辑因而不能得到机会。这个因果关系由最终源码的调用顺序推导，本文未做运行时复现。

#5250 的生产代码变更集中在 `heartbeat()`：把获取引用与发送心跳放入 `try`，捕获 `Exception` 后调用 `_clear_supervisor_refs()` 并重新抛出异常。失败仍向外层报告，引用却不会留给下一轮继续复用。下一次获取引用可以重新解析 Supervisor；在旧地址解析失败并且 HTTP endpoint 可用时，再通过既有刷新逻辑发现新内部地址。

需要准确区分新增代码与既有上下文：[最终 helper](https://github.com/xorbitsai/inference/blob/04b23212797ca2ae53ec8c942b9484a98206e339/xinference/core/worker.py#L1237) 同时将 `_registered` 设为 `False`；[最终 get_supervisor_ref](https://github.com/xorbitsai/inference/blob/04b23212797ca2ae53ec8c942b9484a98206e339/xinference/core/worker.py#L1143) 区分“已经取得 actor 引用”与“已经注册”，保证心跳先取得引用之后，后续 `add_worker=True` 仍能执行注册。这两处逻辑在 #5250 基线已存在，不是这个 PR 新增。#5250 新增的是失败心跳调用既有失效方法。

因此两次工作可以串成“具备重建能力，然后保证故障路径能够进入重建”的工程叙事。不能把 #4731 与 #5250 之间数月间的其他改动也归为这两个 PR。

## 测试和 review 的实际范围

以下描述测试代码的断言，不表示本文执行了上游测试。

[4731 的 test_worker.py](https://github.com/xorbitsai/inference/blob/d82b3f6e12a1d788aa1de432ede3e9dc5528d1f3/xinference/core/tests/test_worker.py#L352) 新增覆盖：状态上报失败后重新注册并回放两个模型；旧内部地址解析失败时通过 endpoint 刷新；健康连接不刷新；重复注册可重建普通副本并跳过 rank0；保留多 Worker 分片；不同分片乱序回放后恢复 shard 顺序；单 Worker 模型的实例详情和两个副本的 `READY` 状态。多 Worker 用例还明确断言 StatusGuard 没有对应实例详情。

部分 Worker 用例使用真实 xoscar actor pool 与 `MockWorkerActor`，但 Supervisor 引用、地址解析和模型对象采用 dummy 或 monkeypatch；Supervisor 重建用例直接创建 `SupervisorActor()`，配合 DummyStatusGuard 和 DummyReplicaWorkerRef。[CLI 测试](https://github.com/xorbitsai/inference/blob/d82b3f6e12a1d788aa1de432ede3e9dc5528d1f3/xinference/deploy/test/test_cmdline.py#L274) 验证 endpoint 与内部地址传递。新增 patch 没有真实 Supervisor 主进程销毁再启动，也没有 Supervisor actor 销毁再创建的完整恢复测试。

[5250 新测试](https://github.com/xorbitsai/inference/blob/04b23212797ca2ae53ec8c942b9484a98206e339/xinference/core/tests/test_worker.py#L433) 用失败引用抛出 `ConnectionRefusedError`，断言异常继续抛出、Supervisor 与四个辅助引用均清空、`_registered` 为 `False`。它直接验证缓存失效，没有在同一用例中执行下一轮心跳、HTTP 地址发现、重新注册或模型推理。

[5250 PR 描述](https://github.com/xorbitsai/inference/pull/5250) 报告执行 `python -m compileall`、`git diff --check` 和隔离的心跳重连检查，并明确说本地缺少 `xoscar`，无法执行完整 pytest。因此不能写成“全量上游测试通过”，也不能把本文博客构建检查等同于 Xinference 运行验证。

[4731 review comments API](https://api.github.com/repos/xorbitsai/inference/pulls/4731/comments?per_page=100) 与 [5250 review comments API](https://api.github.com/repos/xorbitsai/inference/pulls/5250/comments?per_page=100) 均为空。两者均有 qinxuye 的批准 review；#5250 另有机器人总结。来源：[4731 reviews](https://api.github.com/repos/xorbitsai/inference/pulls/4731/reviews?per_page=100)、[5250 reviews](https://api.github.com/repos/xorbitsai/inference/pulls/5250/reviews?per_page=100)。批准意见不是压测或真实故障演练证据。

## 能表达的价值与不能扩展的结论

这两个 PR 没有提供恢复耗时、模型加载节省时间、GPU 利用率、吞吐或延迟的 benchmark。文章可以讨论减少重新部署操作与避免无谓重新加载模型的工程价值，但不得编造数量化收益。

可从代码确认的是：保留本地模型状态的 Worker 有了重新发现、重新注册与副本元数据回放路径；失败心跳会主动使缓存 actor 引用失效。源码与这些测试不足以保证正在执行的请求继续完成、重启期间 API 持续可用、零中断、零丢请求、所有引擎恢复或完整高可用。恢复仍依赖 HTTP endpoint、actor 通道、存活 Worker 和后续状态上报。合理的后续故障演练应分别验证同地址/变地址重启、HTTP endpoint 暂时不可用、心跳到完整注册的过程、分片乱序与缺失，以及恢复后的真实模型请求；这些是建议验证项目，并非已完成的实验。
