# AAFE Agent Runtime 分享 Slide Deck

---

## 1. AAFE Agent Runtime

- 让 AI Coding 从功能堆叠走向架构化落地
- Universal Frontend Architecture Runtime
- Project Memory + Architecture Locator + DDD + Design Pattern Advisor
- 分享时间：2026年6月17日 星期三 15:23:12

---

## 2. 背景：复杂功能下 AI Coding 的问题

- 模型擅长局部逻辑实现，但不主动做架构设计
- 复杂需求容易变成功能堆叠、组件肥大、状态混乱
- 缺少设计模式意识：Strategy / Command / State Machine / Adapter 等不会自然出现
- 每次任务重复扫源码，上下文浪费严重
- 失败经验不沉淀，下一次继续重复犯错

---

## 3. AAFE 的核心目标

- 让 AI 在写代码前先理解项目结构和历史决策
- 让复杂需求先经过 DDD、模块拆分和设计模式选择
- 让架构约束通过 Gate 进入执行链路
- 让成功经验沉淀为可复用 Memory
- 把 AI Coding 从“直接写代码”升级为“架构运行时”

---

## 4. 架构化执行链路

- Memory Recall：读取项目记忆
- Project Architecture Locator：快速定位路由、组件、模块和设计文档
- DDD Discovery：识别领域、上下文、聚合
- Module Decomposition：拆分模块边界
- Pattern Selection：选择设计模式
- Critique + Experience + Memory：审查、经验沉淀、记忆写入

---

## 5. 项目内 Runtime 结构

- .ai-agent/runtime：engine、router、gates、protocol、memory
- .ai-agent/skills：架构、DDD、模式、批判、经验沉淀
- .ai-agent/pipelines：feature、domain-feature、pattern-feature、graph-feature
- .ai-agent/scenarios：complex、ddd、patterns、graph、workflow
- .ai-agent/memory：设计、组件、约定、决策、经验、架构索引

---

## 6. 案例：bkbase-mirror 清洗任务画布

- commit：1f1de9a6a356a9424ae7c92f17e55bc19a7c909d
- message：feat: 优化整体设计模式 --story=134005410
- 模块：datahub / data-detail / clean-task
- 场景：画布节点、连线、算子编辑、输出选择、规则编译、调试、只读预览
- 这是典型的复杂前端功能，而不是简单组件需求

---

## 7. 案例数据：从大 Store 到架构分层

- 113 files changed
- 8559 insertions / 4952 deletions
- useCleanTaskStore.ts：删除 3738 行，新增 95 行
- 新增 application / domain / rules / infrastructure / store / engine / components 分层
- 核心变化不是“写更多代码”，而是把复杂度放到正确位置

---

## 8. 重构前的问题画像

- Store 承载 session / graph / debug / output / ui / persistence / rules
- 页面组件和 Store 混合画布、调试、规则、保存逻辑
- 编辑态和只读预览态互相污染
- 业务规则散落在 UI 和状态层
- AI 后续补需求只能继续在大文件里堆逻辑

---

## 9. 重构后的模块边界

- application：用例编排、画布动作、调试动作、持久化动作
- domain：图查询、只读图、输出选择、校验、时间格式
- rules：清洗规则编译、输入路径、输出规则、算子规则
- infrastructure：布局算法适配
- store：session / graph / debug / output / ui 状态分治
- engine / components：画布运行时与 UI 展示

---

## 10. 设计模式落地

- Facade：useCleanTaskStore 保持旧入口，内部组合子 Store 和 actions
- Use Case Orchestrator：application/actions 编排业务用例
- Domain Service：domain/graph/readonly-graph 承载只读图转换
- Adapter / Strategy：layout service 适配布局算法，错误处理和时间格式策略化
- Registry：节点类型、渲染器、图标注册
- State Partition：状态所有权拆分，避免万能 Store

---

## 11. 只读画布案例：领域逻辑抽离

- 只读预览不是禁用按钮，而是构建一份只读图投影
- getReadonlyVisibleNodes：过滤可见节点
- buildReadonlyVirtualEdges：构建虚拟边
- buildReadonlyGraph：生成只读图结构
- getReadonlyNodeHeight：按节点类型和状态计算高度
- UI 只消费结果，不再承载业务规则

---

## 12. Application Actions：从函数堆叠到用例编排

- graph-actions：节点创建、连线维护、布局和子树查询
- debug-actions / debug-result-actions：调试流程和结果处理
- persistence-actions：保存、恢复、部署相关流程
- rules actions：画布规则编译和重建
- Action 只做编排，规则交给 domain / rules / infrastructure

---

## 13. Store 分治：Reactive Ownership

- session：任务、模式、保存状态、部署状态
- graph：节点、边、选中、根节点、只读位置
- debug：调试输入、调试结果、补充调试
- output：输出配置、字段类型、算子输出列表
- ui：侧栏、搜索、菜单、编辑节点、草稿
- 状态归属清晰，AI 后续可以快速定位修改范围

---

## 14. 这个案例证明了什么？

- 复杂功能不能继续补丁式堆逻辑
- 必须先识别子域和模块边界
- 用 Facade 兼容旧入口，降低迁移风险
- 用 Action / Command 承载用例
- 用 Domain Service 承载规则
- 用 Adapter / Strategy / Registry 承载变化点
- 这正是 AAFE 要注入 AI 执行过程的能力

---

## 15. 自我进化与经验沉淀

- 同一问题重复处理三次仍存在问题时触发经验沉淀
- 只记录最终成功思路、决策路径、适用边界和避免项
- 不记录完整试错过程和噪声信息
- 对画布 / 工作流 / 节点编辑器类问题沉淀可复用架构路径
- 下一次遇到类似问题时复用成功路径

---

## 16. GitHub SKILLS vs npm CLI

- GitHub SKILLS：给 Agent / AI 工具下载协作能力
- npm CLI：给业务项目初始化 .ai-agent Runtime
- aafe skills 只用于 Agent SKILLS 下载
- aafe init/update/analyze/doctor 只用于项目内 Runtime
- 两条链路互不替代，避免配置污染

---

## 17. 价值总结

- 从代码生成升级为架构执行
- 从一次性问答升级为项目记忆
- 从随机实现升级为设计模式选择
- 从功能堆叠升级为模块边界
- 从失败重试升级为经验沉淀
- 让 AI 能按项目架构持续交付复杂功能

---

## 18. 一句话总结

- AAFE 不是让 AI 更快地堆代码
- 而是让 AI 在复杂前端项目中：
  - 先理解项目
  - 再拆分边界
  - 再选择模式
  - 最后落地实现
- 目标：持续交付可维护的复杂功能
