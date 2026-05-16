# Code Agent

## 项目简介
`Code Agent` 是一个本地 CLI Coding Agent（命令行代码助手）项目。

当前已支持“先规划再执行”的受控改动流程：
- 只读检索与多轮问答；
- Plan Mode（计划模式）；
- 写文件与命令执行（带权限确认）。

## 使用说明
### 1. 克隆项目
```bash
git clone <你的仓库地址> code-agent
cd code-agent
```

### 2. 安装依赖
```bash
npm install
```

### 3. 配置环境变量
```bash
cp .env.example .env
```

最小示例：
```env
LLM_PROVIDER=qwen
LLM_API_KEY=your_api_key
LLM_MODEL=qwen3-coder-plus
MAX_AGENT_LOOPS=12
```

当前支持的 provider（模型提供方）：
- `qwen`
- `zhipu`
- `deepseek`
- `bytedance`

### 4. 构建项目
```bash
npm run build
```

### 5. 启动运行
```bash
npm run start -- "解释 package.json"
npm run start -- --plan "重构 queryLoop"
```

如果你希望直接使用 `ca` 命令，可以在构建后执行：
```bash
npm link
```

## Quick Start（快速开始）
### 基础命令
用于确认项目能正常构建、检查类型和跑测试：

```bash
npm run build
npm run typecheck
npm run test
```

### 启动命令
用于单次问答、进入 REPL（持续聊天模式）和基础诊断：

```bash
npm run start -- "解释 package.json"
ca "解释 package.json"
ca --plan "重构 queryLoop"
ca
ca doctor
```

说明：
- `npm run start -- "..."` 不依赖全局命令，最稳；
- `ca` 需要先执行一次 `npm link`。
- `ca --plan "..."` 会进入单次计划模式，只做分析和规划，不会执行改动。

### 开发命令
用于本地开发时直接运行 TypeScript 源码：

```bash
npm run dev -- "这个项目是做什么的"
npm run start:debug -- "解释 package.json"
npm run dev:debug -- "解释 package.json"
```

### 调试命令
用于查看过程日志、HTTP 摘要和调整循环上限：

```bash
CA_SHOW_CHAT_TRACE=0 ca "解释这个项目"
LLM_DEBUG_HTTP=1 npm run start -- "解释 package.json"
MAX_AGENT_LOOPS=20 ca "分析这个项目"
```

### 受控执行命令
用于触发改动能力（写文件/执行命令）：

```bash
ca --plan "把 queryLoop 拆成更清晰的小函数"
ca
# 进入 REPL 后可用 /plan 与 /approve
```

说明：
- 改动类工具（`write_file`、`exec_command`）会先显示预览，再询问是否批准；
- `exec_command` 仅允许白名单验证命令（如 `npm run build`、`npm run typecheck`、`npm run test`）。

### 常见错误排查
出现请求失败时，先跑一遍：

```bash
ca doctor
```

高频错误可先按下面排查：
- `HTTP 401`：通常是 API Key 错误或过期，优先检查 `LLM_API_KEY`（或 provider 专属 key）。
- `HTTP 403`：通常是模型权限/额度不足（包括 free tier 用尽），去 provider 控制台确认配额和模型权限。
- `HTTP 404` 或空响应：优先检查 `LLM_BASE_URL` 与 `LLM_MODEL` 是否匹配当前 provider。
- `HTTP 429`：请求太频繁，降低并发或延长重试间隔。
- `DNS/连接失败`：检查网络、代理、公司内网策略以及目标域名连通性。
- `响应不是有效 JSON`：常见于网关返回 HTML 错页，重点检查是否把控制台页面地址误填为 `LLM_BASE_URL`。
- `请求超时`：先检查网络质量，再考虑增大 `LLM_TIMEOUT_MS`。

### 工程命令
用于代码检查与格式化：

```bash
npm run lint
npm run lint:fix
npm run format
npm run test:unit
npm run test:integration
```

### REPL（持续聊天模式）内置命令
```text
/help
/session
/last
/plan <需求>
/approve
clear
exit
quit
```

补充说明：
- REPL 会自动保存最近会话；
- 下次进入同目录 REPL 时会尝试恢复最近会话；
- 如果你想丢弃恢复数据，可在 REPL 中执行 `clear` 后退出。

## 项目结构说明
### 目录结构
```text
src/
├─ cli/        # 命令入口、REPL、输出、doctor
├─ app/        # QueryEngine（会话编排器）
├─ loop/       # QueryLoop（单轮智能体循环）
├─ permissions/# Permission Model（allow/ask/deny）
├─ tools/      # 工具系统与工具注册
├─ llm/        # 模型请求与 Provider（模型提供方）接入
├─ session/    # Session Storage（会话保存与恢复）
└─ core/       # 配置、消息模型、错误类型等基础设施
```

### 关键入口文件
- `src/cli/index.ts`：CLI 主入口，负责区分单次问答、REPL（持续聊天模式）和 `doctor`
- `src/app/queryEngine.ts`：`QueryEngine（会话编排器）`，负责组织一个会话
- `src/loop/queryLoop.ts`：`QueryLoop（单轮智能体循环）`，负责“模型 -> 工具 -> 继续/结束”
- `src/tools/registry.ts`：工具注册入口，统一管理检索工具与受控执行工具
- `src/tools/writeFile.ts`：`write_file`，项目内安全写文件（含差异预览）
- `src/tools/execCommand.ts`：`exec_command`，白名单命令执行（含超时与结果摘要）
- `src/permissions/check.ts`：统一权限裁决（allow / ask / deny）
- `src/llm/chatClient.ts`：模型请求、Provider（模型提供方）接入和 HTTP 调试输出
- `src/session/storage.ts`：最近会话的保存与恢复

### 导入路径约定
- 项目内部模块统一使用 `#src/*` 固定别名导入，例如：`import { QueryEngine } from "#src/app/queryEngine.js"`。
- 不再使用跨目录相对路径（如 `../../`、`../`）导入项目模块。
- 源码模式（dev/test）通过 `--conditions=source` 解析到 `src/*`，生产模式（start）默认解析到 `dist/*`。

## 相关文档
- [AGENTS.md](./AGENTS.md)：AI 代理（如 Codex）的执行方式
- [CONSTRAINTS.md](./CONSTRAINTS.md)：硬约束与工程边界
- [docs/文档中心.md](./docs/文档中心.md)：文档导航
- [docs/产品说明.md](./docs/产品说明.md)：产品定义、目标用户、产品原则
- [docs/version-plan/版本总览.md](./docs/version-plan/版本总览.md)：版本总览、版本进度、覆盖承诺与详细版本入口
- [docs/变更记录.md](./docs/变更记录.md)：版本记录
