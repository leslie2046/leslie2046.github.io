export interface Project {
  name: string;
  repo: string;
  description: string;
  category: string;
  technology: string;
}

// Curated from the public repository READMEs. Order controls the project grid.
export const projects: Project[] = [
  {
    name: 'PrismLab',
    repo: 'benchmarks',
    description: '连接已有的模型服务，测试 LLM、Embedding、Reranker、语音识别与 Dify 接口。通过 Web 控制台或 CLI 发起测试，比较吞吐、延迟和运行记录。',
    category: '性能测试',
    technology: 'Python',
  },
  {
    name: 'Dify × RAGFlow',
    repo: 'dify-ragflow-plugin',
    description: '把 RAGFlow 接入 Dify 工作流，管理知识库、文档与分块，执行检索，并使用记忆创建、消息写入和搜索等能力。',
    category: '知识检索',
    technology: 'Python',
  },
  {
    name: 'Dify Knowledge',
    repo: 'dify-knowledge-plugin',
    description: '围绕 Dify Knowledge API 构建工具：查看知识库和文档分段，写入文本、跟踪索引，以及跨多个知识库检索并去重。',
    category: '知识库工具',
    technology: 'Python',
  },
  {
    name: 'Dify MinIO',
    repo: 'dify-plugin-minio',
    description: '在 Dify 中读写 MinIO 对象存储。支持文本与文件上传、对象列表、前缀过滤和自定义元数据，让存储操作进入工作流。',
    category: '对象存储',
    technology: 'Python',
  },
  {
    name: 'Dify Backup',
    repo: 'dify_backup_plugin',
    description: '导出 Dify 应用 DSL、标注数据与知识库文件，支持批量导出、草稿和已发布版本选择，便于备份、归档与环境迁移。',
    category: '备份与迁移',
    technology: 'Python',
  },
  {
    name: 'Dify Lingua',
    repo: 'dify-plugin-lingua',
    description: '基于 Lingua 的语言检测插件，为 Dify 提供文本语种识别能力，方便在多语言应用中组织后续处理流程。',
    category: '语言识别',
    technology: 'Python',
  },
  {
    name: 'Dify Moderation',
    repo: 'moderation_plugin',
    description: '为 Dify 输入和输出提供关键词审核。可分别配置处理策略，在命中关键词时返回预设回复或遮盖内容，并通过 API Key 保护调用。',
    category: '内容审核',
    technology: 'Python',
  },
  {
    name: 'LLM 推理显微镜',
    repo: 'three-body',
    description: '用 Three.js 交互场景解释模型内存、TTFT 与 TPOT。调整模型、量化、上下文和 Batch，观察内存估算及计算、带宽对理论下界的影响。',
    category: '交互可视化',
    technology: 'JavaScript · Three.js',
  },
  {
    name: 'Agent Skills',
    repo: 'skills',
    description: '整理供编程助手使用的技能，包含图像生成与 RustFS／S3 对象存储操作，把常用工具的使用方式沉淀为可复用流程。',
    category: 'Agent 工具',
    technology: 'Python',
  },
];
