# AAFE Agent Runtime 分享稿：让 AI Coding 从功能堆叠走向架构化落地

> 案例增强版，结合 bkbase-mirror commit `1f1de9a6a356a9424ae7c92f17e55bc19a7c909d`。

## 1. AAFE Agent Runtime

**主题**：让 AI Coding 从功能堆叠走向架构化落地

**要点**：

- Universal Frontend Architecture Runtime
- Project Memory + Architecture Locator + DDD + Design Pattern Advisor
- 案例：bkbase-mirror 清洗任务画布设计模式优化

**演讲展开**：

今天分享 AAFE Agent Runtime。它不是让 AI 更快堆代码，而是让 AI 在复杂前端项目中具备架构化执行能力。我们会结合 bkbase-mirror 的真实提交，看它如何把架构设计、模式选择和经验沉淀变成执行流程。

---

## 2. 背景：AI 会写代码，但不天然会做架构

**要点**：

- 模型擅长局部逻辑实现：补组件、接接口、修简单 Bug
- 复杂功能下容易继续往现有组件、Store、工具函数里加代码
- 不会天然主动选择设计模式，也不会维护模块边界
- 短期可运行，长期形成组件肥大、状态混乱、修改风险升高

**演讲展开**：

AI 在局部代码生成上很强，但复杂业务不是局部代码题，而是系统设计题。没有额外约束时，模型会沿着现有代码最短路径补逻辑，最终导致组件和 Store 越来越胖。

---

## 3. 核心问题：复杂功能不是“多写代码”

**要点**：

- 复杂功能包含多状态、多阶段、多策略、多模块协作
- 需要先回答：边界在哪里？变化点在哪里？状态归谁？
- 需要设计：Facade / Command / Strategy / Adapter / Registry / Domain Service
- 没有架构运行时，模型默认不会把这些问题前置处理

**演讲展开**：

复杂功能的难点不是代码量，而是决策量。画布类功能涉及节点、连线、布局、编辑态、只读态、调试和保存。AAFE 的目标是让这些架构问题成为执行前置条件。

---

## 4. AAFE 的目标：把架构思考变成执行链路

**要点**：

- Memory Recall：先读取项目记忆和历史决策
- Architecture Locator：快速定位路由、组件、模块、设计说明
- DDD / Architecture / Pattern：先建模、拆边界、选模式
- Gate / Critique / Experience：先校验，再实现，再沉淀

**演讲展开**：

AAFE 不依赖模型临场发挥，而是把架构思考拆成流程：读记忆、定位项目、建模、拆边界、选模式、过 Gate、实现、审查、沉淀。

---

## 5. AAFE Runtime 在项目内生成什么

**要点**：

- .ai-agent/runtime：engine、router、gates、protocol、memory
- .ai-agent/skills：架构、DDD、模式、批判、经验沉淀技能
- .ai-agent/pipelines：feature、domain-feature、pattern-feature、graph-feature
- .ai-agent/memory：项目记忆、架构索引、设计决策、经验

**演讲展开**：

安装 npm 包后，项目会得到 .ai-agent Runtime。它不是提示词合集，而是项目级执行协议、技能、管线和记忆系统。

---

## 6. 案例：bkbase-mirror 清洗任务画布

**要点**：

- commit：1f1de9a6a356a9424ae7c92f17e55bc19a7c909d
- message：feat: 优化整体设计模式 --story=134005410
- 模块：datahub/views/data-detail/clean-task
- 场景：画布节点、连线、算子编辑、输出选择、规则编译、调试、只读预览

**演讲展开**：

这个案例是典型复杂前端模块：图形画布、节点连线、算子配置、规则编译、调试执行和只读预览都在一起。直接让 AI 补功能，很容易走向逻辑堆叠。

---

## 7. 案例数据：这是一次架构重排，不是普通改动

**要点**：

- 113 files changed
- 8559 insertions / 4952 deletions
- useCleanTaskStore.ts：删除约 3738 行，新增约 95 行
- 新增 application / domain / rules / infrastructure / store / engine / components 分层

**演讲展开**：

这次提交的重点不是代码量，而是复杂度迁移。useCleanTaskStore 从巨大 Store 收敛为 facade，复杂逻辑被放回不同架构层。

---

## 8. 重构前：AI 容易沿着旧结构继续堆叠

**要点**：

- Index.vue 调 Store，Store 内继续增加状态和 actions
- 画布、规则、接口、UI、调试、保存逻辑混在一起
- 编辑态和只读态互相污染
- 每次新需求都需要理解大文件，误改风险高

**演讲展开**：

重构前的典型路径是页面调 Store，Store 继续加状态和方法。AI 如果没有架构约束，会继续沿着这条路径补代码。

---

## 9. 重构后：Facade 保持入口，内部完成分治

**要点**：

- useCleanTaskStore 变成兼容旧调用方的 facade
- 内部组合 session / graph / debug / output / ui 子 Store
- actions 统一由 createCleanTaskStoreActions 编排
- derived 只保留编辑节点、调试状态、逻辑链、只读图等派生结果

**演讲展开**：

重构后保留 useCleanTaskStore 入口降低迁移风险，但内部用子 Store 和 actions 分治。Facade 解决兼容性，分层解决长期维护。

---

## 10. 模块边界：把复杂度放到正确位置

**要点**：

- application：用例编排、画布动作、调试动作、持久化动作
- domain：图查询、只读图转换、输出选择、校验、时间格式
- rules：清洗规则编译、输入路径、输出规则、算子规则
- infrastructure：布局服务 Adapter；engine/components：画布运行时与 UI

**演讲展开**：

AAFE 期望模型先判断功能属于哪个边界：用例编排、领域规则、规则转换、外部适配、画布运行时还是 UI 展示。

---

## 11. 设计模式 1：Facade + State Partition

**要点**：

- Facade：保留 useCleanTaskStore 入口，降低迁移和调用方改造成本
- State Partition：session / graph / debug / output / ui 状态所有权拆分
- reactive ownership 清晰：UI 状态不污染图结构，调试状态不污染输出配置
- AI 后续修改能按状态归属快速定位范围

**演讲展开**：

Facade 保兼容，State Partition 明确状态所有权。这样 AI 后续接需求时能快速知道该改 session、graph、debug、output 还是 ui。

---

## 12. 设计模式 2：Use Case Orchestrator / Command

**要点**：

- graph-actions：节点创建、连线维护、布局和子树查询
- debug-actions / debug-result-actions：调试流程和结果处理
- persistence-actions：保存、恢复、部署流程
- Action 负责编排，不承载所有规则细节

**演讲展开**：

application/actions 不是普通工具函数，而是业务用例入口。它们编排流程，但规则交给 domain 和 rules，外部能力交给 infrastructure。

---

## 13. 设计模式 3：Domain Service / Projection

**要点**：

- 只读预览不是禁用按钮，而是构建只读图投影
- domain/graph/readonly-graph.ts 承载只读图转换规则
- getReadonlyVisibleNodes / buildReadonlyVirtualEdges / buildReadonlyGraph
- UI 只消费结果，画布引擎不关心规则细节

**演讲展开**：

只读预览需要过滤节点、构建虚拟边、应用位置和计算高度。这些不是 UI 细节，而是领域投影规则，应该放到 domain。

---

## 14. 设计模式 4：Adapter / Strategy / Registry

**要点**：

- Adapter：clean-task-layout-service 适配布局能力
- Strategy：错误处理、时间格式、布局计算可策略化
- Registry：节点类型、渲染器、图标、布局模块统一注册
- 变化点被隔离，新算子 / 新布局 / 新渲染方式不再牵动全局

**演讲展开**：

画布类功能变化点很多。Adapter 隔离外部能力，Strategy 管可替换逻辑，Registry 管可扩展注册点。

---

## 15. AAFE 如何指导类似案例

**要点**：

- 先用 analyze 生成项目架构索引，避免盲扫源码
- 识别 graph-feature / workflow / complex 场景，选择对应 Pipeline
- 按 domain / application / infrastructure / presentation / graph-runtime 拆边界
- 根据变化点选择 Facade / Command / Strategy / Adapter / Registry 等模式

**演讲展开**：

AAFE 面对类似需求不会直接写代码，而是先定位项目，再识别场景，再拆边界，最后选择设计模式和实现路径。

---

## 16. Gate：阻止模型过早进入实现

**要点**：

- architecture_gate：必须有边界、拆分、模式选择
- pattern_gate：必须完成模式访谈、选择和模块映射
- implementation_gate：必须识别风险和扩展点
- merge_gate：必须通过 critique，避免未审查方案沉淀

**演讲展开**：

Gate 的价值是阻止模型过早实现。复杂功能没有边界、模式和风险识别，就不应该进入代码阶段。

---

## 17. 自我进化：把成功路径沉淀下来

**要点**：

- 同一问题重复处理三次仍失败时，最终成功后触发经验沉淀
- 只记录解决思路、决策路径、适用边界和避免项
- 不记录完整试错过程，避免 Memory 变流水账
- 类似画布 / 工作流 / 节点编辑器问题可复用架构路径

**演讲展开**：

经验沉淀不是记录所有过程，而是在重复失败后记录最终成功路径。这个案例可沉淀为巨大 Store 先拆边界，再用 Facade、Action、Domain Service、Adapter、Registry 组合解决。

---

## 18. 分发方式：GitHub SKILLS vs npm CLI

**要点**：

- GitHub SKILLS：给 Agent / AI 工具直接下载协作能力
- npm CLI：给业务项目初始化和更新 .ai-agent Runtime
- aafe skills 只负责 Agent SKILLS 下载
- aafe init/update/analyze/doctor 只负责项目内 Runtime

**演讲展开**：

AAFE 有两条分发链路。GitHub SKILLS 面向 Agent 能力下载；npm CLI 面向业务项目 Runtime 初始化和更新，两者不能混用。

---

## 19. 价值总结

**要点**：

- 从代码生成升级为架构执行
- 从功能堆叠升级为模块边界
- 从随机实现升级为设计模式选择
- 从一次性问答升级为项目记忆
- 从失败重试升级为经验沉淀

**演讲展开**：

AAFE 的价值是把工程师希望 AI 遵守的架构方法论固化成运行时，让 AI 按项目结构和历史经验持续交付。

---

## 20. 一句话总结

**要点**：

- AAFE 不是让 AI 更快地堆代码
- 而是让 AI 在复杂前端项目中：先理解项目、再拆分边界、再选择模式、最后落地实现
- 目标：持续交付可维护、可演进的复杂功能

**演讲展开**：

一句话总结：AAFE 不是让 AI 更快堆代码，而是让 AI 先理解项目，再拆边界，再选模式，最后落地实现。

---

