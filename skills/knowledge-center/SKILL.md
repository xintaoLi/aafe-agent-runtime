---
name: knowledge-center
description: 在前端项目中安装、初始化和维护 AI Project Knowledge Center；自动采集页面、路由、组件、Store、API、测试和依赖关系，沉淀项目知识，生成影响分析，并通过 Git/CI/运行时事件持续更新 CMS。适用于要求建设或使用 Knowledge CMS、项目知识图谱、AI Search、组件影响分析、自动知识同步的场景。
argument-hint: 传入目标项目路径、技术栈、初始化/扫描/同步/查询/影响分析/审核任务和 CMS 部署方式；未提供路径时使用当前项目。
---

# Knowledge Center Skill

## 目标

把目标项目接入 Knowledge Center，使 CMS 成为项目知识的可视化管理入口。Markdown、JSON 和数据库只是实现细节；所有知识都必须区分来源、版本、置信度和审核状态。

本 Skill 通过 AAFE Runtime 的 Pipeline、Hook、Gate、Memory 和 Skill 模型执行。目标项目已经存在架构说明时，优先使用架构说明和 Mermaid 图作为项目知识入口，不重新生成一套脱离项目实际的深度站点。它只在用户明确指定的目标项目中安装项目配置、扫描器、知识快照和 AI 项目管理集成文件。

## 能力边界

### 自动采集

- Route、Page、Vue/React Component
- Props、Emits、Slots、Template 节点
- Pinia/Vuex/Redux/Store
- API Client、OpenAPI、请求调用
- Import、Export、组件和模块依赖
- Test、TestCase 与覆盖关系
- Git commit、PR 变更和知识版本
- 浏览器运行时的 DOM、截图、事件、网络请求（已配置 Runtime Collector 时）

### 人工补充或审核

- 业务说明和业务规则
- 状态机语义
- UI Flow 的正式版本
- 测试策略和风险等级
- 负责人、领域边界和发布状态
- 自动推断但缺少充分证据的关系

不要把自动扫描结果当作业务事实；所有推断必须标记来源和置信度。

## 现有架构说明优先策略

如果目标项目存在 `.docs`、`docs` 或用户明确指定的架构目录：

1. 先读取文档入口、专题架构说明、流程图索引和 Mermaid `.mmd` 文件。
2. 将文档和图表登记为 `ArchitectureSource`、`ArchitectureDiagram` 和 `ArchitectureDecision`，保留原始路径和版本。
3. 使用文档中的模块、路由、状态、API、存储和调用链作为 AI 项目管理的初始上下文。
4. 文档与代码冲突时，以当前代码为事实，同时生成待审核的架构冲突记录。
5. 不将领域名称强行转换为 CRM 业务实体；Knowledge Center 的 CRM 命名表示项目管理场景，而非要求项目必须存在客户、商机等领域模型。
6. 不生成独立的深度纯站点；优先提供基于现有架构说明的 AI 查询、任务规划、影响分析、变更审核和知识更新。

AAFE CLI 的 `aafe analyze` 默认读取项目根目录 `.docs`，也支持：

```bash
aafe analyze --architecture-docs=/path/to/project/.docs
```

生成的 `.ai-agent/memory/knowledge-center-architecture.md` 作为 Knowledge Center 的项目架构入口，与已有 `project-architecture.md` 和原始 `.docs` 保持引用关系。

## 项目安装结构

在目标项目中创建或更新：

```text
.ai-agent/knowledge-center/
├── config.yaml
├── pipelines/
│   ├── knowledge-scan.yaml
│   ├── knowledge-sync.yaml
│   ├── knowledge-review.yaml
│   └── knowledge-publish.yaml
├── gates/
│   ├── source-reference.yaml
│   ├── stale-knowledge.yaml
│   └── publish.yaml
└── skills/
    ├── project-discovery.md
    ├── code-knowledge-scanner.md
    ├── graph-builder.md
    ├── impact-analyzer.md
    └── ai-search.md

.knowledge-center/
├── snapshots/
├── diffs/
├── reviews/
├── runtime/
├── screenshots/
└── cache/
```

如果目标项目已有同名目录，先读取并增量更新，不覆盖人工维护内容。

## 初始化流程

1. 确认目标项目路径，禁止猜测写入目录。
2. 读取 `package.json`、框架配置、路由、Store 和 API 目录。
3. 识别 Vue、React、Next、Nuxt、Router、Pinia/Vuex、OpenAPI 和测试框架。
4. 创建 Knowledge Center 配置，记录扫描范围、排除目录、项目标识和同步模式。
5. 注册适用的 Framework Pack 和 Scanner Skill。
6. 运行首次 `knowledge-scan`，生成首个知识快照。
7. 执行来源、陈旧关系和发布门禁。
8. 通过门禁后发布到本地 CMS 或已配置的 Knowledge Center 服务。

## 统一知识模型

实体至少包含：

```text
Project, Page, Route, Component, Store, API, Event,
State, Flow, Screenshot, DOMSnapshot, TestCase, File,
Function, BusinessRule, Person, Change
```

实体字段必须包含：

```text
id, type, name, projectId, source, confidence,
status, version, filePath, line, commit, scannedAt
```

关系至少包含：

```text
Page HAS_ROUTE Route
Page USES Component
Component PARENT_OF Component
Component READS_FROM Store
Component CALLS API
Component EMITS Event
Component COVERED_BY TestCase
File DEFINES Component
Change IMPACTS Page
Change IMPACTS Component
```

关系必须携带 `source`、`confidence`、`validFrom` 和 `validTo`。代码事实优先来自 AST/Git，运行时事实来自 Collector，业务知识来自人工或 AI 草稿。

## 自动更新流程

### 本地扫描

```bash
aafe knowledge scan
 aafe knowledge diff
 aafe knowledge sync
```

如果当前 CLI 尚未注册 `knowledge` 命令，则使用目标项目安装的 Knowledge Center CLI 或 Runtime Pipeline 执行等价操作；不要修改 AAFE Runtime 仓库来临时绕过 Skill 边界。

### CI/PR 同步

```text
Pull Request
→ 增量 AST 扫描
→ Knowledge Diff
→ Impact Analysis
→ Source/Confidence Gate
→ CMS Preview
```

### CLI 初始化与更新

发布 npm 后，目标项目可以直接使用：

```bash
npx --yes @aafe/agent-runtime@latest knowledge init
npx --yes @aafe/agent-runtime@latest knowledge update
npx --yes @aafe/agent-runtime@latest knowledge sync
```

默认行为：

- 读取项目 `.docs`、Markdown、MDX 和 Mermaid 图；
- 扫描当前项目代码、路由、组件、模块和架构来源；
- 自动更新 `.docs/aafe-generated/` 下的 Knowledge 视图；
- 保留原始 `.docs` 文档，只覆盖 CLI 管理的生成视图；
- 让 Knowledge Center 直接读取生成视图和原始架构来源。

生成文件：

```text
.docs/aafe-generated/README.md
.docs/aafe-generated/组件关系.md
.docs/aafe-generated/业务关系与数据流.md
.docs/aafe-generated/影响范围与测试预测.md
```

预览更新：

```bash
npx --yes @aafe/agent-runtime@latest knowledge update --dry-run
```

自定义路径：

```bash
npx --yes @aafe/agent-runtime@latest knowledge update \
  --architecture-docs=.docs \
  --knowledge-docs=.docs/aafe-generated
```

Knowledge Web 可视化：

```bash
npx --yes @aafe/agent-runtime@latest knowledge-web
npx --yes @aafe/agent-runtime@latest knowledge-web --serve --port=4173
```

默认生成模块化 Knowledge Web：

```text
.docs/aafe-generated/knowledge-web/
├── index.html
├── modules.html
├── routes.html
├── components.html
├── sources.html
├── impact.html
├── diagrams/*.html
└── site.json
```

执行时根据目标项目动态生成模块，不使用固定 CRM 页面模板。架构来源中的 `.mmd` 文件必须单独生成预览页面，并提供源码查看和 Mermaid Live Editor 在线打开入口。`--serve` 启动本地只读服务；页面是现有 `.docs` 与 Knowledge 视图的可视化索引，不创建脱离项目的独立深度站点。

`aafe update` 负责刷新项目 Runtime、Skills 和编辑器入口；`aafe knowledge update` 负责刷新项目架构关系和 Knowledge 视图，二者职责不同但可以连续执行。

默认项目初始化会启用任务完成钩子。任务成功结束后，自动执行：

```text
aafe knowledge update
→ aafe update
→ aafe doctor
```

执行结果写入 `.ai-agent/memory/knowledge-sync.jsonl`，其中 `aafe knowledge-web` 会刷新模块化可视页面，并将影响范围和 P0/P1/P2 测试推荐写入 `impact.html`。钩子失败默认不阻断原任务（`failClosed: false`），但会在任务结果和日志中标记失败。需要严格阻断时，可在 `.aafe.config.json` 将 `taskCompletion.failClosed` 改为 `true`。

### 合并后发布

```text
Merge
→ 增量或全量扫描
→ 更新实体和关系
→ 刷新全文/语义/图索引
→ 发布 Knowledge Version
→ 生成变更摘要
```

自动更新规则：

- 新增实体和代码关系：可自动发布。
- 删除实体或关系：标记失效并进入审核。
- 业务说明、负责人、风险等级：不得自动覆盖。
- UI Flow 和状态机：自动生成草稿，人工确认后发布。
- AI 摘要：必须保留引用实体、文件路径和 commit。
- 扫描失败：保留上一版知识，不得发布不完整快照。

## AI Search 与影响分析

回答自然语言问题时遵循：

```text
意图识别
→ 实体解析
→ 结构化过滤
→ 图关系扩展
→ Memory/全文/语义检索
→ 证据汇总
→ 带引用回答
```

每个结论至少提供实体、源码路径或快照版本。无法确认时标记为“推测”“待审核”或“静态分析未覆盖”。

优先支持：

- 修改组件会影响哪些页面？
- 哪些组件调用了某个 API？
- 哪个 Store 被某个功能依赖？
- 变更后的最小测试集合是什么？
- 某个页面的组件、API、Store 和历史变更是什么？
- 哪些知识因本次 PR 变得陈旧？

## Memory 集成

使用 AAFE Memory 保存架构决策、业务约定、历史原因、团队习惯和人工补充；使用 Knowledge Store 保存页面、组件、API、Store、文件和关系事实。查询时合并两者，不将经验当成代码事实。

知识写入前检查重复、来源和适用范围。只有经过验证的、可复用的结论才沉淀为长期 Memory。

## CMS 页面要求

首版 CMS 至少提供：

- Dashboard
- Pages
- Components
- Stores
- APIs
- Relations/Graph
- Changes
- AI Search
- Impact Analysis
- Review Queue

实体详情需要显示源码跳转、来源、置信度、扫描版本、最近变更和人工补充字段。禁止只展示没有证据的 AI 摘要。

## 安全与边界

- 不上传源码、截图、环境变量或密钥，除非用户明确配置了目标服务和传输范围。
- 不读取 `.env`、密钥、Cookie、Token 或凭证文件作为知识内容。
- 扫描默认排除 `node_modules`、构建产物、缓存和凭证目录。
- CMS 权限应至少区分查看、扫描、审核、发布和管理。
- 删除知识使用软删除或失效标记，保留版本历史。
- 执行写入前确认目标项目，不在 AAFE Runtime 源码仓库生成业务项目知识。

## 与现有项目架构 Skill 的协作

目标项目通过 `aafe analyze` 生成的 `project-architecture-locator.md` 负责快速定位源码；`knowledge-center-architecture.md` 负责登记 `.docs` 文档和 Mermaid 图；`knowledge-center-architecture.md` 对应的项目 Skill 负责在 AI 任务执行前加载架构上下文。三者共同构成单一项目知识入口，不重复生成独立站点。

对于当前 bklog/web 类项目，应优先参考：

- `.docs/日志检索V3架构与数据链路.md`：检索初始化、Worker、NDJSON/JSON、IndexedDB、分页和竞态。
- `.docs/架构图.md`：总体架构、启动、路由、Store、HTTP 和模块边界。
- `.docs/diagrams/D-Retrieve检索模块初始化数据流.mmd`
- `.docs/diagrams/F-Vuex-Store状态流转图.mmd`
- `.docs/diagrams/G-检索模块API调用链路图.mmd`
- `.docs/diagrams/I-完整页面请求时序图.mmd`
- `.docs/diagrams/K-分层架构全景图.mmd`

AI 项目管理必须围绕这些已有架构资产执行：需求拆解、模块定位、影响分析、实施计划、验证路径、变更记录和 Memory 沉淀。CRM Knowledge 在这里表示项目知识管理能力，不代表要把日志检索项目重新建模为 CRM 业务系统。

## 全局强制完成约束

每个任务、修复、重构、配置变更或文档更新完成前，必须执行最后一次架构影响复盘：

1. 根据目标项目 `.docs` 中的架构说明、Mermaid 图和相关模块关系，列出直接影响、间接影响和潜在影响。
2. 说明影响依据，引用相关 `.docs` 文件、图表、模块、路由、Store、API、Worker、Storage 和源码路径。
3. 预测需要测试的范围，至少覆盖适用的单元、组件、集成、端到端、回归和异常/降级路径。
4. 给出 P0/P1/P2 测试优先级及预测原因。
5. 明确区分已实际执行、仅预测和未覆盖的测试；不得把预测写成已通过。
6. 列出未验证项、风险、文档与代码冲突以及需要人工确认的内容。

对于当前 bklog/web 的检索链路，若涉及查询、字段、分页、流式解析、请求取消、Worker、缓存或 IndexedDB，必须额外预测：

- NDJSON 与 JSON envelope 两种响应路径；
- 首屏 replace 与分页 append；
- stale response、取消、超时和并发竞态；
- IndexedDB 正常路径、不可用时的内存降级、TTL/GC；
- Vuex 元数据、row_keys 与结果组件延迟读取；
- 路由切换、空间切换和权限/鉴权异常。

## 输出要求

完成后汇报：

1. 目标项目和技术栈。
2. 已安装的 Scanner、Pipeline 和 Gate。
3. 首次或增量扫描结果。
4. 新增/变更/失效实体和关系数量。
5. CMS 或同步服务地址（如已配置）。
6. 未确认知识、扫描盲区和后续审核项。
7. 可复现的扫描、同步、查询和影响分析命令。
