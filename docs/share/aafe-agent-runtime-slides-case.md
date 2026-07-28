# AAFE Agent Runtime 案例增强版 Slide Deck

---

## 1. AAFE Agent Runtime

> 让 AI Coding 从功能堆叠走向架构化落地

- Universal Frontend Architecture Runtime
- Project Memory + Architecture Locator + DDD + Design Pattern Advisor
- 案例：bkbase-mirror 清洗任务画布设计模式优化

---

## 2. 背景：AI 会写代码，但不天然会做架构

- 模型擅长局部逻辑实现：补组件、接接口、修简单 Bug
- 复杂功能下容易继续往现有组件、Store、工具函数里加代码
- 不会天然主动选择设计模式，也不会维护模块边界
- 短期可运行，长期形成组件肥大、状态混乱、修改风险升高

---

## 3. 核心问题：复杂功能不是“多写代码”

- 复杂功能包含多状态、多阶段、多策略、多模块协作
- 需要先回答：边界在哪里？变化点在哪里？状态归谁？
- 需要设计：Facade / Command / Strategy / Adapter / Registry / Domain Service
- 没有架构运行时，模型默认不会把这些问题前置处理

---

## 4. AAFE 的目标：把架构思考变成执行链路

- Memory Recall：先读取项目记忆和历史决策
- Architecture Locator：快速定位路由、组件、模块、设计说明
- DDD / Architecture / Pattern：先建模、拆边界、选模式
- Gate / Critique / Experience：先校验，再实现，再沉淀

---

## 5. AAFE Runtime 在项目内生成什么

- .ai-agent/runtime：engine、router、gates、protocol、memory
- .ai-agent/skills：架构、DDD、模式、批判、经验沉淀技能
- .ai-agent/pipelines：feature、domain-feature、pattern-feature、graph-feature
- .ai-agent/memory：项目记忆、架构索引、设计决策、经验

---

## 6. 案例：bkbase-mirror 清洗任务画布

- commit：1f1de9a6a356a9424ae7c92f17e55bc19a7c909d
- message：feat: 优化整体设计模式 --story=134005410
- 模块：datahub/views/data-detail/clean-task
- 场景：画布节点、连线、算子编辑、输出选择、规则编译、调试、只读预览

---

## 7. 案例数据：这是一次架构重排，不是普通改动

- 113 files changed
- 8559 insertions / 4952 deletions
- useCleanTaskStore.ts：删除约 3738 行，新增约 95 行
- 新增 application / domain / rules / infrastructure / store / engine / components 分层

---

## 8. 重构前：AI 容易沿着旧结构继续堆叠

- Index.vue 调 Store，Store 内继续增加状态和 actions
- 画布、规则、接口、UI、调试、保存逻辑混在一起
- 编辑态和只读态互相污染
- 每次新需求都需要理解大文件，误改风险高

---

## 9. 重构后：Facade 保持入口，内部完成分治

- useCleanTaskStore 变成兼容旧调用方的 facade
- 内部组合 session / graph / debug / output / ui 子 Store
- actions 统一由 createCleanTaskStoreActions 编排
- derived 只保留编辑节点、调试状态、逻辑链、只读图等派生结果

---

## 10. 模块边界：把复杂度放到正确位置

- application：用例编排、画布动作、调试动作、持久化动作
- domain：图查询、只读图转换、输出选择、校验、时间格式
- rules：清洗规则编译、输入路径、输出规则、算子规则
- infrastructure：布局服务 Adapter；engine/components：画布运行时与 UI

---

## 11. 设计模式 1：Facade + State Partition

- Facade：保留 useCleanTaskStore 入口，降低迁移和调用方改造成本
- State Partition：session / graph / debug / output / ui 状态所有权拆分
- reactive ownership 清晰：UI 状态不污染图结构，调试状态不污染输出配置
- AI 后续修改能按状态归属快速定位范围

---

## 12. 设计模式 2：Use Case Orchestrator / Command

- graph-actions：节点创建、连线维护、布局和子树查询
- debug-actions / debug-result-actions：调试流程和结果处理
- persistence-actions：保存、恢复、部署流程
- Action 负责编排，不承载所有规则细节

---

## 13. 设计模式 3：Domain Service / Projection

- 只读预览不是禁用按钮，而是构建只读图投影
- domain/graph/readonly-graph.ts 承载只读图转换规则
- getReadonlyVisibleNodes / buildReadonlyVirtualEdges / buildReadonlyGraph
- UI 只消费结果，画布引擎不关心规则细节

---

## 14. 设计模式 4：Adapter / Strategy / Registry

- Adapter：clean-task-layout-service 适配布局能力
- Strategy：错误处理、时间格式、布局计算可策略化
- Registry：节点类型、渲染器、图标、布局模块统一注册
- 变化点被隔离，新算子 / 新布局 / 新渲染方式不再牵动全局

---

## 15. AAFE 如何指导类似案例

- 先用 analyze 生成项目架构索引，避免盲扫源码
- 识别 graph-feature / workflow / complex 场景，选择对应 Pipeline
- 按 domain / application / infrastructure / presentation / graph-runtime 拆边界
- 根据变化点选择 Facade / Command / Strategy / Adapter / Registry 等模式

---

## 16. Gate：阻止模型过早进入实现

- architecture_gate：必须有边界、拆分、模式选择
- pattern_gate：必须完成模式访谈、选择和模块映射
- implementation_gate：必须识别风险和扩展点
- merge_gate：必须通过 critique，避免未审查方案沉淀

---

## 17. 自我进化：把成功路径沉淀下来

- 同一问题重复处理三次仍失败时，最终成功后触发经验沉淀
- 只记录解决思路、决策路径、适用边界和避免项
- 不记录完整试错过程，避免 Memory 变流水账
- 类似画布 / 工作流 / 节点编辑器问题可复用架构路径

---

## 18. 分发方式：GitHub SKILLS vs npm CLI

- GitHub SKILLS：给 Agent / AI 工具直接下载协作能力
- npm CLI：给业务项目初始化和更新 .ai-agent Runtime
- aafe skills 只负责 Agent SKILLS 下载
- aafe init/update/analyze/doctor 只负责项目内 Runtime

---

## 19. 价值总结

- 从代码生成升级为架构执行
- 从功能堆叠升级为模块边界
- 从随机实现升级为设计模式选择
- 从一次性问答升级为项目记忆
- 从失败重试升级为经验沉淀

---

## 20. 一句话总结

- AAFE 不是让 AI 更快地堆代码
- 而是让 AI 在复杂前端项目中：先理解项目、再拆分边界、再选择模式、最后落地实现
- 目标：持续交付可维护、可演进的复杂功能

