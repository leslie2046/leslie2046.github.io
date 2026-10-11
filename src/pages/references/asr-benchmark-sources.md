---
layout: '../../layouts/Reference.astro'
title: 'ASR 模型测试口径与模型资料记录'
article: '/posts/asr-model-benchmark/'
---

测试值来自用户提供的两张表。用户确认延迟单位为秒，列名为输入音频时长，字正确率按 1−CER 计算。测试日期未记录；页面整理日期为 2026-10-11。

## 数据处理

延迟表包含 14 组部署、每组 4 个音频时长，共 56 个数值。字正确率表包含 11 个模型或热词配置、2 个测试集，共 22 个数值。CPU 使用 Xeon E5-2650 v3 @ 2.30GHz，其他延迟记录使用 P40，全部延迟测试入口为 Xinference。

去掉原表的“新”字样，因为它没有对应版本号；CPU 信息单独成列。Qwen3-ASR-0.6B 的字正确率按原表同列口径补上百分号。没有为普通 Paraformer、CPU 识别效果或 xunfei 延迟补造数据。CSV 是汇总记录，未包含逐请求日志。

## 提供资料中的训练规模与参数量

以下保留提供资料的背景备注，不视为本次实测，也不据此推导模型效果。小时数与参数量分列；未给出的值保持空缺。

| 模型 | 训练规模备注 | 参数量备注 |
| --- | --- | --- |
| njueaiv2 | 2339 小时，905 小时机器人语料 + 1434 小时近场公开语料 | 未提供 |
| SenseVoiceSmall | 40 万小时 | 234M |
| seaco-paraformer-zh | 60000 小时，中文 | 220M |
| paraformer-zh-hotword | 60000 小时，中文 | 220M |
| whisper-large-v3 | 500 万小时；具体数据划分需核对原模型资料 | 1550M |
| Fun-ASR-Nano-2512 | 数千万小时 | 0.8B |
| Fun-ASR-MLT-Nano-2512 | 数十万小时 | 0.8B |
| xunfei | 未知 | 未提供 |
| Qwen3-ASR-1.7B | 未提供 | 1.7B |
| Qwen3-ASR-0.6B | 未提供 | 0.6B |

原来的 training data 列混合了小时数与参数量，整理时未将 1.7B、0.6B 等参数规模解释为训练数据量。训练样本与测试集是否重叠，现有记录无法判断。

## 官方能力资料

- [SenseVoice](https://github.com/QwenAudio/SenseVoice)：Small 模型覆盖中文、粤语、英文、日文、韩文，支持 ASR、LID、SER、AED。整个模型家族的语言范围不等于 Small 检查点的范围。
- [Fun-ASR](https://github.com/QwenAudio/Fun-ASR)：Nano 与 MLT 检查点语言覆盖不同；MLT 列出 31 种语言。Nano 的方言、地域口音、歌词与说唱能力属于官方功能描述，没有在本报告中单独测量。
- [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR)：两种参数规模列出 30 种语言和 22 种中文方言；本次未做这些语言的全面测试。

## 提供资料中的 Paraformer 模型标识

以下保留模型 ID 供复测时核对，不据名称推断本次部署一定包含相关流水线。原资料描述的时间戳、长音频、分角色和热词能力，需以实际启动配置验证。

| 资料中的用途 | 模型 ID |
| --- | --- |
| 长音频，VAD 与标点组合 | `iic/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch` |
| 分角色处理组合 | `iic/speech_paraformer-large-vad-punc-spk_asr_nat-zh-cn` |
| 普通 Paraformer | `iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch` |
| Paraformer 热词版 | `iic/speech_paraformer-large-contextual_asr_nat-zh-cn-16k-common-vocab8404` |
| SeACoParaformer | `iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch` |

## 数值核对

Qwen3-ASR-1.7B 在 T1H 的最高记录为 92.3%，Fun-ASR-Nano-2512 在 S5H 的最高记录为 96.9%。热词配置的变化为 T1H +0.2 个百分点、S5H +1.0 个百分点。7 秒音频上，SenseVoiceSmall P40 的 RTF 为 0.26/7≈0.037，普通 Paraformer CPU 为 0.54/7≈0.077。
