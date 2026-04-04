# Coverage

## 说明
这份文档回答两个关键问题：
1. 新版本路线是否真的覆盖了参考项目最重要的功能与知识点？
2. 走完整条路线之后，是否真的足以做出一个“完全可用”的 Claude Code / Codex 同类 CLI 产品？

结论先说：
- 对“核心 CLI 产品能力”和“核心架构知识点”，这套路线是按 `1.0.0` 全覆盖设计的；
- 对参考项目里一些外围、实验性、企业化、非 CLI 核心能力，不作为 `1.0.0` 阻塞项；
- 这意味着 `1.0.0` 的目标是“完整可用的同类 CLI 产品”，不是“参考仓库所有外围模块逐项复刻”。

## 什么叫“全覆盖”
这里的“全覆盖”指：
- 参考项目的核心产品骨架要覆盖；
- 参考项目的核心执行链路要覆盖；
- 参考项目的核心安全模型要覆盖；
- 参考项目的核心上下文与 provider 设计要覆盖；
- 参考项目里支撑长期使用的工程化能力要覆盖。

## 覆盖矩阵
| 参考主题 | 参考文件/文档 | 覆盖版本 | 学到什么 | 做到什么算覆盖完成 |
| --- | --- | --- | --- | --- |
| 入口分发 | `src/entrypoints/cli.tsx`, `src/main.tsx` | `v0.1.0`, `v0.6.0`, `v0.7.0` | CLI 入口、命令分发、运行时初始化 | 具备多入口 CLI，能跑普通模式、REPL、doctor、daemon、resume |
| 单轮 Agentic Loop | `src/query.ts`, `docs/conversation/the-loop.mdx` | `v0.1.0`, `v0.1.1` | 单轮状态机、继续/终止条件、tool result 回填 | `QueryLoop` 独立存在，能稳定跑模型 -> 工具 -> 继续 |
| QueryEngine 会话编排 | `src/QueryEngine.ts`, `docs/conversation/multi-turn.mdx` | `v0.1.0`, `v0.2.0`, `v0.7.0` | 单轮与多轮分层、会话持有、恢复思路 | `QueryEngine` 独立持有会话、权限、计划和恢复状态 |
| Tool Protocol | `src/Tool.ts`, `src/tools.ts` | `v0.1.0`, `v0.3.0`, `v0.5.0` | 工具定义、元数据、危险性、并发安全 | 所有工具通过统一协议注册、执行、回报结果 |
| 检索与导航工具 | `src/tools.ts`, docs tools | `v0.2.0`, `v0.2.1` | 读代码不是猜，而是查 | `read_file/list_files/search_files` 形成项目级只读工具组 |
| REPL 与多轮对话 | `src/screens/REPL.tsx`, `docs/conversation/multi-turn.mdx` | `v0.2.0`, `v0.2.1` | 持续对话、历史保留、会话体验 | CLI 支持 REPL、多轮追问、恢复最近会话 |
| 权限模型 | `docs/safety/permission-model.mdx` | `v0.3.0`, `v0.3.1` | `allow/ask/deny`、会话级权限上下文 | 工具执行前统一权限判定，用户确认链路稳定 |
| Plan Mode | `docs/safety/plan-mode.mdx` | `v0.3.0`, `v0.3.1` | 先规划再执行如何做成系统能力 | 只读规划模式与执行模式切换跑通 |
| 写文件与命令执行 | `src/tools.ts`, tool orchestration | `v0.3.0`, `v0.3.1` | 危险工具接入、确认、失败回填 | 能安全改文件、跑验证命令、返回结构化结果 |
| 流式输出与打字机效果 | `docs/conversation/streaming.mdx`, stream adapter | `v0.4.0`, `v0.4.1` | 事件流、状态反馈、渲染解耦 | 用户能实时看到模型输出和工具进度 |
| 系统提示与上下文组装 | `src/context.ts`, `docs/context/system-prompt.mdx` | `v0.4.0`, `v0.4.1`, `v0.8.0` | 系统规则、会话历史、计划状态如何组装 | 有统一 `buildContext()`，规则/历史/记忆进入同一上下文系统 |
| Provider 兼容层 | `docs/plans/openai-compatibility.md`, `src/services/api/openai/*` | `v0.5.0` | 外部 API 差异如何收敛为内部协议 | QueryLoop 不再感知 provider 差异 |
| 工具编排与流式工具执行 | `toolOrchestration.ts`, `StreamingToolExecutor.ts` | `v0.5.0` | 工具执行器、进度事件、历史记录 | 工具执行统一经过 orchestrator / executor |
| Core 抽离与工程边界 | `src/main.tsx`, overall architecture | `v0.6.0` | core 与 shell 的分离 | 有 `packages/core` 和 `packages/cli` 的稳定边界 |
| MCP / Skills / 扩展能力 | tools/context/docs | `v0.6.0` | 外部工具和知识如何统一接入 | MCP、Skills 都走统一工具/上下文协议 |
| 后台会话与守护进程 | CLI entrypoints, session runtime | `v0.7.0` | 前后台分离、恢复、附着 | 会话可后台运行、可恢复、可附着 |
| 子 Agent / 协调 / 工作树隔离 | advanced tools / team concepts | `v0.8.0` | 任务拆分、上下文隔离、结果聚合 | 主 Agent 可调度子 Agent，且隔离明确 |
| 高级上下文管理 | context system | `v0.8.0` | budget、摘要、压缩、恢复重建 | 长会话能稳定继续，恢复不靠原始全文回放 |
| 观测、测试、发布工程 | README/package/docs | `v0.9.0` | 交付能力、回归能力、诊断能力 | 产品具备完整测试、doctor、日志、发布脚本 |
| 同类 CLI 产品完成版 | 上述全部 | `v1.0.0` | 将架构、能力、工程合成一个完整产品 | 可长期使用、可交付、可扩展、可继续演进 |

## 中途可用性矩阵
| 版本 | 可用程度 | 适合谁用 | 典型场景 |
| --- | --- | --- | --- |
| `v0.2.1` | 只读可用 | 你自己 / 1-2 个试用者 | 问项目结构、找文件、追问代码逻辑 |
| `v0.3.1` | 安全改动可用 | 你自己日常开发 | 先规划、再改小功能、再跑验证 |
| `v0.4.1` | 个人主力可用 | 你自己长期使用 | 多轮分析、修改、验证、持续会话 |
| `v0.9.0` | 发布候选可用 | 小范围外部用户 | 稳定试用、回归验证、分发试装 |
| `v1.0.0` | 完整可用 | 更广泛的 CLI 用户 | 作为完整的本地 coding agent 使用 |

## 不作为 `1.0.0` 阻塞项的内容
这些内容即使参考仓库里出现，也不应阻塞 `1.0.0`：
- Voice
- Computer Use
- Chrome/browser automation 的完整产品化
- 企业级 telemetry / GrowthBook / Sentry 平台化接入
- 云端多用户后台服务
- 非 CLI 形态的完整桌面端产品

这些更适合放在 `1.x` 或单独的产品线里。

## 最终承诺
如果严格按这套版本路线推进，并且每版都真的把“代码结构 + 功能边界 + 学习目标”做扎实，到了 `1.0.0`：
- 你会真正理解参考项目的核心精华；
- 你会做出一个完整可用的同类 CLI 产品；
- 这个产品已经足以作为后续做 Codex / Claude Code 风格更大产品的底盘。
