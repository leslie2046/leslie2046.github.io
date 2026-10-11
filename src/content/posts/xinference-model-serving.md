---
title: 'Xinference Supervisor 重启之后：从模型副本重建到真正的重连'
description: '模型还在 worker 上运行，管理状态却可能已经丢失。串起 PR #4731 与 #5250，理解副本状态回放、幂等注册，以及旧 Actor 引用为什么会阻断恢复。'
date: 2026-10-11
tags: [Xinference, 分布式系统, 故障恢复, 模型服务, 开源]
category: 工程实践
cover: /images/xinference-recovery.svg
source: https://github.com/xorbitsai/inference/pull/4731
references: /references/xinference-sources/
download: /downloads/xinference-model-serving.md
---

![Xinference Supervisor 重启恢复：重连、副本状态回放与管理状态重建](/images/xinference-recovery.svg)

封面为概念示意。本文讨论存活 worker 上的模型副本重新接入管理层，不承诺重启期间请求无中断，也不代表所有模型部署形态都能恢复。

- 作者：[Leslie / leslie2046](https://github.com/leslie2046)
- 写作日期：2026-10-11
- 相关贡献：[PR #4731](https://github.com/xorbitsai/inference/pull/4731) 与 [PR #5250](https://github.com/xorbitsai/inference/pull/5250)
- 本文分别以两个 PR 的最终代码为依据，不将合并提交当作发行版本号。

## 1. 管理服务重启，为什么模型也要重新部署？

在分布式模型服务中，Supervisor 负责管理 worker、维护模型副本映射，并帮助请求找到对应的模型；worker 则承载实际模型。它们的生命周期未必同步。

如果 Supervisor 重启了，worker 和模型进程可能仍然存活。但 Supervisor 内存里的注册表已经丢失：哪些模型副本在哪些 worker 上、有哪些分片、实例状态是什么，都需要重新建立。

于是会出现一个不直观的状态：**模型在运行，管理层却不知道如何找到它。** 重新启动 worker、重新部署模型可以让状态重新对齐，但对仍然健康的模型而言，这是一项本可避免的操作。

[PR #4731](https://github.com/xorbitsai/inference/pull/4731) 针对的就是这个问题：Supervisor 重启后，由 worker 重新连接，并上报自身及模型副本的信息，让管理层重建状态。

几个月后的 [PR #5250](https://github.com/xorbitsai/inference/pull/5250) 又补上了恢复路径中的一个关键环节：心跳失败时清理缓存的 Supervisor 引用，使下一次尝试有机会发现重启后的新内部地址。

把两个改动放在一起看，能更清楚地理解故障恢复的完整链路。

## 2. 第一层恢复：让 worker 回放自己持有的副本信息

#4731 改动之前，worker 初次连接时的注册逻辑主要面向没有模型的新 worker。改动后，注册可以携带 `replica_states`，把已有副本一并上报。

worker 根据自己的模型规格和启动参数，整理出重建所需的信息，包括副本 UID、模型名称与版本、能力、worker 数量、分片序号和创建时间。启动路径也新增了启动时间记录，用于后续回放。[worker 最终代码](https://github.com/xorbitsai/inference/blob/d82b3f6e12a1d788aa1de432ede3e9dc5528d1f3/xinference/core/worker.py)

这里上报的是**副本元数据与状态**，不是将模型权重上传给 Supervisor，也不是重新加载模型。恢复所依赖的前提，是 worker 仍持有可以回放的运行信息。

在本文中，可以把这理解为：Supervisor 的管理状态丢失之后，让存活的执行节点提供重建依据。这是对改动的架构解释，具体行为仍以源码为准。

### 注册需要允许重复发生

故障恢复时，worker 无法总是准确判断 Supervisor 是否已经处理了上一次注册。重连、重试、状态报告都可能重复触发注册操作。

因此，`add_worker()` 去掉了“该地址必须尚未存在”的断言。处理副本回放前，会清理这个 worker 在已有映射中的旧记录，再根据新上报的信息重建，保留其他 worker 的关联。

它允许同一 worker 重复上报并重新构建映射。这里的幂等性不是简单忽略第二次请求，而是让重复注册能够重新对齐状态。[注册与映射重建实现](https://github.com/xorbitsai/inference/blob/d82b3f6e12a1d788aa1de432ede3e9dc5528d1f3/xinference/core/supervisor.py)

## 3. 不只恢复 worker，还要恢复模型的管理视图

知道 worker 地址，并不意味着模型已经重新可管理。Supervisor 还需要知道模型、副本、worker 和分片之间的关系。

#4731 为这些关系增加了重建逻辑：解析副本 UID，按模型及副本组织信息，恢复副本到 worker 的映射，以及模型对应的副本信息。对于跨 worker 的分片副本，代码记录分片序号并按序排列引用，避免恢复结果仅由 worker 上报顺序决定。

这种排序很重要：分片编号才表示分片的位置，“哪个 worker 先连回来”并不代表它应该排在第一位。

同时，单 worker 副本还会重建 StatusGuard 中的实例及副本状态，包括模型能力、创建时间、worker 地址等信息。否则，路由映射虽然恢复了，管理界面或实例查询看到的状态仍可能不完整。[Supervisor 最终实现](https://github.com/xorbitsai/inference/blob/d82b3f6e12a1d788aa1de432ede3e9dc5528d1f3/xinference/core/supervisor.py)

### 恢复范围需要明确

最终代码并没有无条件重建所有部署形态：

- worker 收集回放状态时跳过带有 `xavier_config` 的副本，因为这类恢复仍依赖 Supervisor 持有的协调状态。
- Supervisor 跳过以 `-rank0` 结尾或无法正常解析的副本 UID，并检查分片元数据。
- 多 worker 分片副本有路由映射重建逻辑，但 StatusGuard 的这条恢复路径跳过 `n_worker > 1` 的状态，不能把路由恢复扩展成完整实例管理状态都已恢复。

这些限制提醒我们，“重建副本”不是一个可以对所有模型统一承诺的动作。除了副本地址，还要检查模型类型所依赖的协调信息是否仍然存在。[worker 回放范围](https://github.com/xorbitsai/inference/blob/d82b3f6e12a1d788aa1de432ede3e9dc5528d1f3/xinference/core/worker.py)；[Supervisor 重建范围](https://github.com/xorbitsai/inference/blob/d82b3f6e12a1d788aa1de432ede3e9dc5528d1f3/xinference/core/supervisor.py)

## 4. 还有一道前提：必须先找到重启后的 Supervisor

状态回放设计好了，连接本身仍可能失败。Supervisor 对外的服务入口与内部 Actor 地址不是同一个概念，重启后内部地址可能变化。

#4731 已加入地址刷新路径：创建 Supervisor Actor 引用失败时，如果 worker 保存了 Supervisor endpoint，就通过 REST 客户端重新查询内部地址，再尝试取得引用。worker 命令行启动路径也将 endpoint 继续传入运行组件。[地址发现实现](https://github.com/xorbitsai/inference/blob/d82b3f6e12a1d788aa1de432ede3e9dc5528d1f3/xinference/core/worker.py)；[启动参数传递](https://github.com/xorbitsai/inference/blob/d82b3f6e12a1d788aa1de432ede3e9dc5528d1f3/xinference/deploy/cmdline.py)

但是，worker 会缓存 `_supervisor_ref`。当这个引用非空时，`get_supervisor_ref()` 可以直接返回它，而不会重新执行引用创建和地址发现。

这就留下了一个容易被忽略的问题：**旧引用仍存在，不代表旧服务仍可达。** 心跳不断拿到同一个旧引用，就可能一直访问重启前的地址，无法走到已经准备好的恢复分支。

“有重试”还不够，重试之前使用的目标也必须能被更新。

## 5. 第二层修复：心跳失败，让旧引用失效

[PR #5250](https://github.com/xorbitsai/inference/pull/5250) 的生产代码改动集中在 `heartbeat()`：心跳调用发生异常时，先调用 `_clear_supervisor_refs()`，然后将异常继续抛出。

用简化代码表示：

```python
# 逻辑示意，省略了真实源码的超时包装和参数。
try:
    await supervisor_ref.receive_heartbeat(worker_address)
except Exception:
    clear_supervisor_refs()
    raise
```

这个异常分支没有直接重载模型，也没有在本次失败调用里完成全部恢复。它的作用是解除“缓存旧引用”的状态，让后续重试可以重新获取引用。

清理方法在该 PR 的最终代码中会重置 Supervisor 引用与注册标志，并清除 StatusGuard、EventCollector、CacheTracker 和 ProgressTracker 的引用。它们都与 Supervisor 侧的服务有关，只更新一个地址而继续沿用旧的辅助引用，仍可能留下不一致的调用目标。

其中 `_registered` 也要重置，后续需要注册的路径才会重新执行 `add_worker()`。这项清理逻辑在 #5250 时已有；本次修复是在心跳异常分支中调用它，不能把 helper 的全部能力都归为这次新写的代码。[#5250 最终 worker 实现](https://github.com/xorbitsai/inference/blob/04b23212797ca2ae53ec8c942b9484a98206e339/xinference/core/worker.py)

将恢复路径合起来，概念上是：

```text
Supervisor 重启，旧连接目标失效
  → worker 心跳失败
  → 清理缓存引用与注册状态
  → 后续尝试重新获取 Supervisor 引用
  → 必要时通过 endpoint 刷新内部地址
  → worker 重新注册并回放存活副本
  → Supervisor 重建支持范围内的映射与管理状态
```

心跳与状态报告的职责也不能混为一谈。最终代码中的心跳使用 `add_worker=False`；副本状态恢复依赖状态报告及注册路径。不能描述成“一次心跳直接重建所有模型”。[心跳和周期状态报告代码](https://github.com/xorbitsai/inference/blob/04b23212797ca2ae53ec8c942b9484a98206e339/xinference/core/worker.py)

## 6. 测试分别证明了什么？

两次改动覆盖的是不同层次的行为：

| 改动 | 核心目标 | 回归测试关注点 |
| --- | --- | --- |
| #4731 | worker 重连后回放副本，重建管理状态 | 断连后重新注册与回放、刷新内部地址、健康连接不刷新、重复注册、分片顺序和实例详情 |
| #5250 | 心跳失败时清理缓存引用 | 旧 Supervisor 引用抛错后，引用与注册状态均被清理，异常继续抛出 |

#4731 的测试使用 Actor 测试环境、mock 和 dummy 引用等方式检查这些行为。它们提供了状态恢复逻辑的回归覆盖，不能据此宣称真实模型、完整 Supervisor 主进程重启和所有请求链路都已端到端验证。[#4731 测试源码](https://github.com/xorbitsai/inference/blob/d82b3f6e12a1d788aa1de432ede3e9dc5528d1f3/xinference/core/tests/test_worker.py)

#5250 的回归测试让旧引用的心跳抛出 `ConnectionRefusedError`，断言缓存引用和注册标志已清理。测试聚焦失败后的本地状态，没有在这个用例里启动新的 Supervisor、运行真实模型或执行完整重连。

PR 描述记录了语法编译、差异检查和隔离的心跳重连检查，同时明确说明：本地缺少 `xoscar`，完整 pytest 未能运行。本文也没有重新执行 Xinference 后端测试。[#5250 测试源码](https://github.com/xorbitsai/inference/blob/04b23212797ca2ae53ec8c942b9484a98206e339/xinference/core/tests/test_worker.py)；[验证说明](https://github.com/xorbitsai/inference/pull/5250)

两个 PR 没有提供可用于比较的恢复耗时或可用性 benchmark，因此这里不填写恢复秒数、成功率或服务可用性百分比。

## 7. 这两次改动为什么有价值？

我认为它们的价值，在于减少管理层重启对仍然健康的执行节点的连带影响，同时把恢复路径中的对象生命周期补齐。

第一次改动让系统能够根据存活节点的信息重建状态；第二次改动说明，即使恢复协议已经存在，一个仍指向旧目标的缓存引用，也可能让系统根本走不到恢复协议。

这给分布式服务的恢复设计提供了几个具体的检查点：

- 管理状态丢失之后，哪些存活节点能够提供重建依据？
- 注册能否安全地重复执行，并清理当前节点的旧记录？
- 稳定的发现入口与会变化的内部地址，是否被分开处理？
- 调用失败之后，缓存引用、注册标志与辅助对象是否一起更新？
- 重建映射、恢复实例状态和恢复正在处理的请求，是否分别验证？

这些是从代码中提炼出的工程思考，不是新增的产品能力声明。

如果要在自己的部署验证，应保留存活 worker，分别测试 Supervisor 内部地址变化、worker 重复上报、多个分片以不同顺序重连，以及实际使用的模型类型。除了确认模型重新出现在列表里，还需要执行新的推理请求，并观察重启期间请求如何失败或恢复。

这类恢复仍依赖 endpoint 可达、worker 保留必要状态和部署形态受支持。worker 自身故障、网络分区、在途请求续接、完整高可用方案，都需要另外设计和验证。

## 相关链接

- [PR #4731：Supervisor 重启后的副本重建](https://github.com/xorbitsai/inference/pull/4731)
- [PR #5250：修复心跳失败后的 worker 重连](https://github.com/xorbitsai/inference/pull/5250)
- [原始问题 #2402](https://github.com/xorbitsai/inference/issues/2402)
- [事实核对记录](/references/xinference-sources/)
