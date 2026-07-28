# AAFE Agent Runtime：让 AI Coding 从功能堆叠走向架构化落地

> 分享时间：2026年6月17日 星期三 15:23:12  
> 项目：`@aafe/agent-runtime`  
> 定位：Universal Frontend Architecture Runtime + Project Memory + Project Architecture Locator + DDD + Design Pattern Advisor  
> 案例：`bkbase-mirror` commit `1f1de9a6a356a9424ae7c92f17e55bc19a7c909d`，`feat: 优化整体设计模式 --story=134005410`

---

## 1. 设计背景：AI 会写代码，但不天然会做架构

在复杂前端项目里，AI 模型非常擅长完成“局部逻辑实现”：补一个组件、写一个接口调用、修一个简单 Bug、生成表单和列表代码。这类任务边界清晰、上下文短、验证路径直接，模型可以很快给出可运行代码。

但当需求进入“超级复杂功能”阶段时，问题会快速暴露：

1. **只做功能堆叠，不做架构设计**  
   模型默认会把新逻辑继续塞进现有组件、Store、工具函数或回调链里。短期能跑，长期会让模块变胖、依赖变乱、修改风险变高。

2. **缺少设计模式意识**  
   面对多策略、多状态、多阶段流程、多端适配、复杂画布交互时，模型通常不会主动问：这里是否需要 Strategy、State Machine、Command、Pipeline、Adapter、Registry、Observer？它更倾向于直接写 if/else 和过程式逻辑。

3. **不会主动维护模块边界**  
   复杂功能通常横跨 domain / application / infrastructure / presentation。没有架构约束时，业务规则容易泄漏到 UI，接口细节容易侵入领域逻辑，状态管理容易变成“万能上帝对象”。

4. **上下文利用低效**  
   每次任务都重新扫源码，模型不知道主要路由在哪里、核心组件在哪里、历史决策是什么、哪些模块不能碰，导致上下文浪费和误改风险增加。

5. **缺少自我进化闭环**  
   如果同一个问题处理多次仍失败，而最终成功经验没有沉淀，下一次模型仍可能重复走错路径。

AAFE Agent Runtime 的目标，就是把 AI Coding 从“直接写代码”升级为“项目级架构化执行”。

---

## 2. AAFE 的核心目标

AAFE 不是单纯的代码生成工具，而是面向前端工程的 **Architecture Runtime**。

它希望解决的问题是：

- 如何让 AI 在写代码前先理解项目结构？
- 如何让 AI 面对复杂需求时先做架构设计？
- 如何让 AI 主动进行设计模式选择，而不是堆叠逻辑？
- 如何让 AI 对 DDD、模块边界、扩展点和 Gate 负责？
- 如何让 AI 在失败后沉淀经验，减少重复犯错？

核心链路是：

```txt
Memory Recall
-> Project Architecture Locator
-> DDD Discovery
-> Architecture Analysis
-> Module Decomposition
-> Pattern Selection
-> Gate Verification
-> Implementation Planning
-> Critique
-> Experience Recorder
-> Memory Write
```

这条链路把“架构思考”变成模型执行任务时必须经过的步骤，而不是依赖模型临场发挥。

---

## 3. 工具实现：项目级 Runtime

在业务项目内安装 npm 包并初始化：

```bash
npm install --save-dev @aafe/agent-runtime
npx aafe init --yes --framework=vue --scenarios=complex --template=complex --editors=cursor
npx aafe doctor
```

生成结构：

```txt
.ai-agent/
├── runtime/      # engine / router / gates / protocol / memory
├── skills/       # 架构、DDD、模式、批判、经验沉淀等执行技能
├── pipelines/    # feature / domain-feature / pattern-feature / graph-feature 等流程
├── scenarios/    # complex / ddd / patterns / graph / workflow 等场景包
├── frameworks/   # vue / react / next / monorepo 等框架包
└── memory/       # 项目记忆、设计说明、经验、架构索引
```

更新已接入项目：

```bash
npm install
npx aafe update
npx aafe analyze
npx aafe doctor
```

其中：

- `update` 刷新 Runtime / Skills / Pipelines，保留已有 Memory；
- `analyze` 生成项目架构索引和定位 Skill；
- `doctor` 校验 Runtime 结构是否完整；
- 所有生成动作都要求幂等，避免重复声明造成上下文浪费。

---

## 4. 架构化执行 Pipeline

AAFE 将复杂功能实现拆成可执行链路：

```txt
User Request
  -> Memory Recall
  -> Project Architecture Locator
  -> DDD Discovery
  -> Bounded Context Mapping
  -> Aggregate Design
  -> Architecture Analysis
  -> Module Decomposition
  -> Pattern Interview
  -> Pattern Selection
  -> Implementation Planning
  -> ADR
  -> Refactor Critique
  -> Experience Recorder
  -> Memory Write
```

这条链路的价值：

- 让模型先分析，再实现；
- 让模型先拆边界，再写代码；
- 让模型先选模式，再落地实现；
- 让模型先通过 Gate，再进入下一阶段；
- 让模型在任务结束后沉淀经验和记忆。

---

## 5. 案例背景：bkbase-mirror 清洗任务画布重构

本次分享结合一个真实复杂前端功能案例：

```txt
仓库：bkbase-mirror
commit：1f1de9a6a356a9424ae7c92f17e55bc19a7c909d
message：feat: 优化整体设计模式 --story=134005410
模块：datahub/views/data-detail/clean-task
```

这个模块是一个典型的复杂前端场景：

- 有画布节点和连线；
- 有算子编辑、输出选择、规则编译、调试执行；
- 有编辑态和只读预览态；
- 有布局算法、节点渲染、端口交互、侧栏、弹窗、底部调试面板；
- 有大量状态和派生数据；
- 需要与后端 API、数据结构、业务规则持续协作。

这类需求如果直接交给 AI 补功能，很容易出现：组件越来越大、Store 越来越厚、函数互相调用、逻辑无法复用、只读态和编辑态互相污染。

---

## 6. 案例数据：一次复杂功能从堆叠走向架构化

该 commit 的变更规模：

```txt
113 files changed
8559 insertions
4952 deletions
```

核心变化不是“多写了代码”，而是把原本集中在一个巨大 Store 和页面组件里的逻辑拆成了多个架构层：

| 层次 | 文件数量变化示例 | 职责 |
| --- | ---: | --- |
| application | 17 个文件 | 用例编排、画布动作、调试动作、持久化动作 |
| domain | 9 个文件 | 图查询、只读图转换、输出选择、校验、时间格式 |
| rules | 5 个文件 | 清洗规则编译、输入路径、输出规则、算子规则 |
| infrastructure | 1 个文件 | 布局服务 Adapter |
| store | 7 个文件 | session / graph / debug / output / ui 状态分治 |
| engine | 40 个文件 | 画布核心、交互、布局、渲染、UI overlay |
| components | 23 个文件 | 页面展示组件和局部交互组件 |

最关键的一个指标：

```txt
store/useCleanTaskStore.ts
- 删除 3738 行
- 新增 95 行
```

也就是从“上帝 Store”收敛为一个 facade 入口：组合多个子 Store、派生数据和 actions，而不是继续承载全部业务复杂度。

---

## 7. 重构前的问题画像

如果没有 AAFE 这类架构 Runtime，AI 面对这类模块通常会继续沿着现有路径堆叠：

```txt
Index.vue
  -> 调用 Store
  -> Store 内部继续增加状态
  -> Store 内部继续增加 actions
  -> actions 里直接处理画布、规则、接口、UI、调试
  -> 新需求继续在同一个地方补逻辑
```

这会带来几个问题：

1. **状态所有权不清晰**  
   session、graph、debug、output、ui 全部混在一起，任何功能都可能改到任何状态。

2. **业务规则和 UI 互相污染**  
   规则编译、输入路径、输出字段、时间格式等逻辑散落在组件和 Store 中。

3. **编辑态和只读态互相影响**  
   只读预览需要隐藏部分数据节点、构建虚拟边、重新计算高度和布局，如果混在画布 UI 逻辑里，后续很难维护。

4. **复用和测试困难**  
   巨大 Store 中的逻辑很难单独验证，AI 每次修改都要理解大段上下文。

5. **扩展风险高**  
   新增算子、新增布局、新增调试能力、新增输出选择，都可能牵动整个模块。

---

## 8. 重构后的架构：Facade + 分层 + 模式组合

重构后，`useCleanTaskStore.ts` 的角色被收敛为 facade：

```ts
export const useCleanTaskStore = defineStore('cleanTask', () => {
  const sessionState = useCleanTaskSessionStore();
  const graphState = useCleanTaskGraphStore();
  const debugState = useCleanTaskDebugStore();
  const outputState = useCleanTaskOutputStore();
  const uiState = useCleanTaskUiStore();

  const actions = createCleanTaskStoreActions({
    session: sessionRefs,
    graph: graphRefs,
    debug: debugRefs,
    output: outputRefs,
    ui: uiRefs,
    getters: { nodeMap, isViewMode },
  });

  return {
    session,
    graph,
    debug,
    output,
    ui,
    derived,
    actions,
  };
});
```

这体现了几个设计模式：

- **Facade**：对旧调用方保留 `useCleanTaskStore` 入口，但内部已分层；
- **Use Case Orchestrator**：`application/actions/*` 负责编排用例；
- **Domain Service / Pure Function**：`domain/*` 承载业务规则和图转换；
- **Adapter**：`infrastructure/layout/clean-task-layout-service.ts` 适配布局算法；
- **Strategy**：布局、错误处理、时间格式等可切换策略；
- **Registry**：节点类型、渲染器、图标等注册机制；
- **State Partition**：session / graph / debug / output / ui 状态所有权拆分。

---

## 9. 案例中的模块边界

重构后的目录天然对应 AAFE 推荐的模块边界：

```txt
clean-task/
├── application/       # 用例和动作编排
├── domain/            # 业务规则和领域逻辑
├── infrastructure/    # 外部能力适配
├── rules/             # 清洗规则编译和转换
├── store/             # 状态分治和 facade
├── engine/            # 画布运行时
└── components/        # UI 组件
```

这就是 AAFE 想让 AI 在复杂任务中先做的事情：

```txt
不要先写代码
先判断功能属于哪个边界
再判断应该进入哪个模块
最后才决定具体实现
```

---

## 10. 案例中的只读画布：领域逻辑从 UI 中抽离

只读预览不是简单地把按钮禁用。它需要：

- 过滤可见节点；
- 隐藏算子输出数据节点，仅保留根节点和算子；
- 构建虚拟连线；
- 根据节点类型和状态计算只读高度；
- 使用只读布局位置渲染。

重构后这些逻辑进入：

```txt
domain/graph/readonly-graph.ts
```

它提供：

```txt
getReadonlyVisibleNodes
buildReadonlyVirtualEdges
buildReadonlyGraph
getReadonlyNodeHeight
getNodeWidth
```

这背后的架构价值是：

- UI 不再关心只读图如何构造；
- 画布引擎只消费最终图结构；
- 只读规则可以独立测试；
- 后续变更只读展示策略时，不需要修改页面主组件。

这就是典型的 **Domain Service + Projection** 思路。

---

## 11. 案例中的画布动作：从 Store 内方法变为 Application Actions

画布新增节点、连线维护、分支输出、布局计算、子树查询等逻辑被迁移到：

```txt
application/actions/canvas/graph-actions.ts
```

调试相关逻辑进入：

```txt
application/actions/debug-actions.ts
application/actions/debug-result-actions.ts
```

保存和恢复进入：

```txt
application/actions/persistence-actions.ts
```

规则编译和重建进入：

```txt
application/actions/rules/*
rules/*
```

这类拆分对应 AAFE 中的 **Command / Use Case Orchestrator / Pipeline**：

- action 不只是一个函数，而是一个业务用例入口；
- action 只编排，不把所有规则写死在自身；
- 规则、图查询、布局、接口适配分别委托给对应模块；
- 后续新增用例可以新增 action，而不是继续污染 Store。

---

## 12. 案例中的 Store 分治：状态所有权变清晰

重构后 Store 被拆为：

```txt
useCleanTaskSessionStore.ts
useCleanTaskGraphStore.ts
useCleanTaskDebugStore.ts
useCleanTaskOutputStore.ts
useCleanTaskUiStore.ts
```

这对应状态所有权拆分：

| Store | 负责内容 |
| --- | --- |
| session | 当前任务、模式、保存状态、部署状态 |
| graph | 节点、边、选中节点、根节点、只读位置 |
| debug | 调试输入、调试结果、补充调试状态 |
| output | 输出配置、字段类型、算子输出列表 |
| ui | 侧栏、搜索、菜单、编辑节点、草稿 |

拆分后的好处：

- 修改 UI 状态不影响图结构；
- 调试逻辑不污染输出配置；
- 保存状态和画布状态分离；
- AI 后续接需求时可以快速定位状态归属。

这就是 AAFE 中强调的 **reactive ownership**。

---

## 13. 这个案例为什么能证明 AAFE 的价值？

如果只是让 AI “实现功能”，它大概率会继续在原 Store 或组件中加逻辑。

而这个 commit 展示的是另一种路径：

```txt
复杂功能
-> 识别画布 / 调试 / 输出 / 规则 / 只读展示等子域
-> 拆分 application / domain / rules / infrastructure / store / engine / components
-> 用 facade 兼容旧入口
-> 用 actions 承载用例编排
-> 用 domain pure functions 承载规则
-> 用 adapter / strategy 承载可替换能力
-> 用 store partition 明确状态所有权
```

这正是 AAFE 要系统化注入到 AI 执行过程中的能力。

---

## 14. AAFE 如何把案例经验沉淀为能力

从这个案例可以沉淀出一条经验：

> 当复杂画布 / 工作流 / 节点编辑器功能出现巨大 Store、组件承载过多规则、编辑态和只读态混杂时，不应继续补丁式加逻辑。应先按 domain / application / infrastructure / presentation / graph-runtime 拆边界，再用 Facade 保持兼容入口，用 Action / Command 编排用例，用 Domain Service 承载纯业务规则，用 Adapter / Strategy 处理布局和外部能力。

在 AAFE 中，这类经验会进入 `experience` 类型 Memory。

触发规则：

```txt
同一个问题重复处理三次仍存在问题
-> 最终方案验证成功
-> 只记录成功思路、决策路径、适用边界和避免项
```

不记录完整试错过程，避免 Memory 变成流水账。

---

## 15. 自我进化机制

AAFE 的自我进化由三部分组成：

1. **Project Memory**：保存项目约定、设计说明、组件规范、历史决策、经验。
2. **Architecture Locator**：生成项目主要路由、组件、模块和设计文档索引，减少 AI 盲目扫描源码。
3. **Experience Recorder**：对重复失败后最终成功的问题，沉淀解决思路和适用边界。

这让 Agent 不再是每次从零开始，而是带着项目知识持续工作。

---

## 16. GitHub SKILLS 与 npm CLI 两条分发链路

AAFE 作为会发布到 GitHub 和 npm 的包，提供两条互不替代的使用方式。

| 场景 | 使用方式 | 写入目标 |
| --- | --- | --- |
| Agent / AI 工具只想获得 AAFE 协作能力 | 从 GitHub 下载 Agent SKILLS | 目标 Agent 的 Skills 目录 |
| 业务项目要接入 AAFE Runtime | 安装 npm 包并执行 CLI | 当前项目 `.ai-agent/`、`.aafe.config.json`、编辑器配置 |

- `aafe skills` 只负责 Agent SKILLS 下载；
- `aafe init/update/analyze/doctor` 只负责业务项目 Runtime。

---

## 17. 价值总结

AAFE Agent Runtime 的核心价值：

1. **从代码生成升级为架构执行**
2. **从功能堆叠升级为模块边界**
3. **从随机实现升级为设计模式选择**
4. **从一次性问答升级为项目记忆**
5. **从失败重试升级为经验沉淀**
6. **从单项目脚本升级为可分发运行时**

---

## 18. 一句话总结

AAFE Agent Runtime 的目标不是让 AI 更快地堆代码，而是让 AI 在复杂前端项目中，能按项目架构、设计模式和历史经验持续交付可维护的复杂功能。
