# PRODUCT.md

## 1. 文档目的
本文件用于定义本项目到底在做什么产品、以什么为主参考、服务谁、做成什么样，以及如何看待当前代码与未来版本的关系。

如果与硬约束冲突，以 `CONSTRAINTS.md` 为准。
如果与版本推进冲突，以 `docs/version-plan/` 为准。

---

## 2. 产品定义
本项目不是一个“灵感型小 Demo”，也不再定义为“Claude Code 与 Codex 的简化版”。

本项目的新定义是：

> 一个以本地参考项目 `claude-code-fork` 为主参考、以 `claude-code` 作为命令行体验参考、以 Mac 版 `Codex` 作为未来桌面端体验参考、逐步重建出来的本地 Coding Agent 项目。

换句话说：
- 在工程实现层，本项目要认真学习、借鉴、重建参考项目的核心骨架；
- 在命令行体验层，本项目优先参考 `claude-code`；
- 在未来桌面端体验层，本项目参考 Mac 版 `Codex`；
- 在产品形态上，当前主目标是 CLI，而不是桌面端。

当前开发环境中的参考仓库路径：
- `/Users/huzhibin/code/my/ai/claude-code-fork`

---

## 3. 为什么做这个项目
做这个项目有两个同样重要的目标：

### 目标 A：做产品
最终做出一个完整可用的本地 Coding Agent。

分阶段看：
- 当前主目标：做出一个完整可用的本地 CLI Coding Agent；
- 未来如果进入桌面端阶段，再让产品体验逐步向 Mac 版 `Codex` 靠近。

这个产品应能帮助开发者：
- 理解项目
- 定位代码
- 规划修改
- 安全改代码
- 执行验证
- 持续多轮协作

### 目标 B：学参考项目
本项目不是只拿参考项目“找灵感”，而是把它当作主要学习对象。

希望通过逐版实现，真正学会参考项目最重要的东西：
- Entrypoint 设计
- QueryEngine
- QueryLoop / Agentic Loop
- Tool Protocol
- Permission Model
- Plan Mode
- Context System
- Provider Adapter
- Tool Orchestration
- Session Runtime
- 扩展能力（MCP / Skills）

---

## 4. 目标用户
### 第一目标用户
作者本人。

具体来说，是：
- 需要长期理解与维护代码库的开发者；
- 当前以 Web 前端工程师视角为主；
- 希望一边做产品，一边真正学懂参考项目。

### 第二目标用户
未来的小范围 CLI 开发者用户。

他们需要的不是“聊天玩具”，而是：
- 能读代码
- 能查代码
- 能规划
- 能改代码
- 能跑验证
- 能长期协作

---

## 5. 产品形态
### 当前主形态
本项目当前主形态是：本地 CLI Agent。

### 未来可能形态
未来可以扩展到桌面端，但那不是当前主线。

如果未来进入桌面端阶段：
- 命令执行骨架仍然延续当前 CLI 产品的 core；
- 桌面端体验会优先参考 Mac 版 `Codex`。

### 非当前主形态
以下不作为当前主线目标：
- Mac 桌面端
- 云端 SaaS
- 浏览器端产品
- 团队协作后台

---

## 6. 产品核心能力
按最终目标，这个产品应逐步具备以下能力：
- 单轮 Agentic Loop
- 多轮对话与 REPL
- QueryEngine 会话编排
- Tool System
- 检索与导航工具
- 写文件与命令执行工具
- 权限模型
- Plan Mode
- 流式输出与打字机效果
- 系统提示与上下文系统
- 项目记忆与会话记忆
- Provider 适配层
- 工具编排与历史记录
- MCP / Skills / 扩展能力
- 后台会话、守护进程与恢复
- 子 Agent、协调与隔离
- 测试、诊断、观测与发布

这些能力的详细落地顺序，不在本文件里展开，统一看：
- `docs/version-plan/README.md`
- `docs/version-plan/COVERAGE.md`
- `docs/version-plan/*.md`

---

## 7. 产品原则
### 7.1 参考项目优先
当“现有实现”与“参考项目主线”冲突时，不要默认保留现有实现。

关键原则：
- 现有实现可以重构；
- 现有实现也可以被推翻；
- 但必须按版本计划小步推进，不一次性照搬参考项目全部复杂度。

### 7.2 骨架优先于功能堆叠
先学和重建骨架，再加功能。

骨架包括：
- QueryEngine
- QueryLoop
- Tool Protocol
- Permission Model
- Context System
- Provider Adapter

### 7.3 体验参考按产品形态区分
- 当前 CLI 阶段：命令行体验优先参考 `claude-code`。
- 未来桌面端阶段：桌面端体验优先参考 Mac 版 `Codex`。
- 不应在 CLI 阶段提前引入大量桌面端思维。

### 7.4 可用性不能只留到 1.0.0
本项目不是等 `1.0.0` 才第一次可用。

版本计划中已经定义了几个关键可用里程碑：
- `v0.2.1`：只读可用版
- `v0.3.1`：安全改动可用版
- `v0.4.1`：个人主力可用版
- `v0.9.0`：发布候选版
- `v1.0.0`：完成版

### 7.5 学习与产品并重
这个项目不是纯学习笔记，也不是纯交付导向的黑盒开发。

要求是：
- 做出真正可用的产品；
- 同时确保你能通过这个过程学懂参考项目的精华。

---

## 8. 当前产品状态
当前代码状态应该这样理解：
- 它是一个已经能运行的早期原型；
- 它不是最终架构；
- 它不是产品定义本身；
- 它只是进入正式版本线之前的基础起点。

因此：
- 不应把当前代码结构当作长期真理；
- 后续如果版本计划要求，允许重构甚至推翻现有结构。

---

## 9. 产品路线的正式来源
从现在开始，产品路线不再以旧的 `ROADMAP.md` 为主。

正式来源改为：
- `docs/version-plan/README.md`
- `docs/version-plan/COVERAGE.md`
- `docs/version-plan/*.md`

其中：
- `README.md`：说明版本策略与里程碑；
- `COVERAGE.md`：说明参考项目覆盖范围；
- 每个版本文档：说明某个版本做什么、学什么、做到什么算进入下一版。

---

## 10. AI 与开发者的对齐规则
AI 在执行任务前，应至少阅读：
1. `CONSTRAINTS.md`
2. `AGENTS.md`
3. `docs/version-plan/README.md`
4. 当前目标版本文档
5. `PRODUCT.md`
6. 必要的参考仓库源码或文档

冲突处理优先级：
`CONSTRAINTS.md` > `AGENTS.md` > `docs/version-plan/*` > `PRODUCT.md` > `README.md` > 当前实现

---

## 11. 一句话总结
一句话定义这个项目：

> 一个以 `claude-code-fork` 为主参考、以 `claude-code` 作为命令行体验参考、以 Mac 版 `Codex` 作为未来桌面端体验参考、通过版本化重构逐步做成完整 Coding Agent 的学习型产品项目。
