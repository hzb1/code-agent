# Code Agent

本项目是一个本地 Coding Agent 重建项目。

它的目标不是停留在当前这份原型代码上，而是：
- 以本地参考项目 `claude-code-fork` 为主参考；
- 当前命令行体验优先参考 `claude-code`；
- 未来桌面端体验参考 Mac 版 `Codex`；
- 逐步做出一个同类、完整、可用的 Coding Agent 产品。

当前开发环境中的参考仓库路径：
- `/Users/huzhibin/code/my/ai/claude-code-fork`

## 这个仓库现在是什么
当前仓库已经有一份可以运行的早期原型，具备：
- CLI 单次提问
- 基础 LLM 调用
- 基础工具调用（当前原型阶段以只读工具为主）
- 骨架级调试事件与基础测试
- 可关闭的过程日志与 HTTP 调试摘要
- 构建与类型检查流程

但要注意：
- 这份实现不是最终产品定义；
- 当前结构不是长期架构答案；
- 后续会按照版本计划持续重构、替换、扩展。

## 这个仓库最终要做成什么
最终目标是做成一个完整的 Coding Agent 产品。

分阶段看：
- 当前主线是本地 CLI Coding Agent；
- 未来如果进入桌面端阶段，再让桌面体验向 Mac 版 `Codex` 靠近。

当前主线下的核心能力包括：
- 多入口 CLI
- REPL 与多轮会话
- QueryEngine
- QueryLoop / Agentic Loop
- Tool System
- 权限模型与 Plan Mode
- 流式输出与打字机效果
- 项目上下文系统与项目记忆
- Provider 适配层
- 工具编排与历史记录
- MCP / Skills / 扩展基础
- 后台会话、恢复、守护进程
- 子 Agent 与高级上下文管理
- 测试、诊断、观测、发布工程

## 主参考与主文档
### 主参考
- 工程实现主参考：`claude-code-fork`
- 命令行体验参考：`claude-code`
- 未来桌面端体验参考：Mac 版 `Codex`

### 先读哪些文档
建议阅读顺序：
1. [CONSTRAINTS.md](/Users/huzhibin/code/my/ai/code-agent/CONSTRAINTS.md)
2. [AGENTS.md](/Users/huzhibin/code/my/ai/code-agent/AGENTS.md)
3. [版本计划总览](/Users/huzhibin/code/my/ai/code-agent/docs/version-plan/README.md)
4. [覆盖矩阵](/Users/huzhibin/code/my/ai/code-agent/docs/version-plan/COVERAGE.md)
5. 当前目标版本文档
6. [PRODUCT.md](/Users/huzhibin/code/my/ai/code-agent/PRODUCT.md)

## 版本推进方式
本项目现在采用“主版本 + 补丁版本”推进：
- `0.x.0`：引入新的能力边界
- `0.x.1`：不引入新的能力边界，只做稳定化、测试、重构、文档收口、交互优化
- `1.0.0`：完成参考项目核心骨架与核心能力覆盖，达到同类 CLI 产品完成版

当前正式版本线从 `0.1.0` 开始，详细见：
- [docs/version-plan/README.md](/Users/huzhibin/code/my/ai/code-agent/docs/version-plan/README.md)

## 中途可用里程碑
不是等到 `1.0.0` 才第一次可用，而是按阶段变得可用：
- `v0.2.1`：只读可用版
- `v0.3.1`：安全改动可用版
- `v0.4.1`：个人主力可用版
- `v0.9.0`：发布候选版
- `v1.0.0`：完成版

## 快速开始（基于当前原型）
### 1. 安装依赖
```bash
npm install
```

### 2. 配置环境变量
```bash
cp .env.example .env
```

示例：
```env
LLM_PROVIDER=qwen
LLM_API_KEY=your_api_key
LLM_MODEL=qwen3-coder-plus
MAX_AGENT_LOOPS=12
```

当前原型支持的 provider：
- `qwen`
- `zhipu`
- `deepseek`
- `bytedance`

### 3. 构建
```bash
npm run build
```

### 4. 类型检查
```bash
npm run typecheck
```

### 5. Lint（Biome）
```bash
npm run lint
```

自动修复：
```bash
npm run lint:fix
```

格式化：
```bash
npm run format
```

### 6. 运行
```bash
npm run start -- "解释 package.json"
```

开发模式：
```bash
npm run dev -- "这个项目是做什么的"
```

默认会在 `stderr` 打印“对话过程”（每轮请求、工具调用、模型回复摘要），便于观察 Agent 在做什么。

如果你只想保留最终答案输出，可关闭过程日志：
```bash
CA_SHOW_CHAT_TRACE=0 ca "解释这个项目"
```

如果你在复杂任务里遇到：
```text
[ca] 已达到最大循环次数限制（...）
```
可以调大循环上限后重试：
```bash
MAX_AGENT_LOOPS=20 ca "分析这个项目"
```

全局命令（推荐）：
```bash
npm link
ca "解释 package.json"
```

## 直接打印 HTTP 调试日志
如果你不想再折腾 Charles，也可以直接让 CLI 打印 LLM 请求/响应摘要。

开启方式：
```bash
LLM_DEBUG_HTTP=1 npm run start -- "解释 package.json"
```

说明：
- 会按 `Request` / `Response` 分段打印请求 URL、model、消息摘要、工具摘要、响应状态码和响应片段；
- `Authorization` 会自动脱敏，不会直接打印完整 key；
- 这更适合排查“发了什么”“回了什么”，读起来也更接近浏览器 Network 面板。

## 当前原型的边界
当前代码还不是完整产品，所以你会看到这些能力仍在版本计划里逐步建设：
- 更完整的检索工具
- 多轮 REPL 与恢复
- 权限模型与 Plan Mode
- 写文件与命令执行
- 流式输出与打字机效果
- 上下文系统与项目记忆
- Provider 适配层
- MCP / Skills / 扩展基础
- 后台会话与子 Agent

所以：
- 不要把当前仓库结构看成最终设计；
- 以版本计划为准，逐步演进。

## 说明
- 当前仅保留 `docs/version-plan/` 下的正式版本计划文档作为执行依据。
