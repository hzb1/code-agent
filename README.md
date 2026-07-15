# Code Agent Learning

## 项目简介
这是一个从学习基线开始、逐版本构建本地 CLI Coding Agent（命令行编码智能体）的项目。

工程实现以本地 `claude-code-fork` 为源码级主参考，CLI 体验参考 `claude-code`。当前工作树不包含旧版 Agent 实现，目的是让核心架构通过预测、查证、实现、调试和迁移真正掌握，而不是照着现成答案修改。

## 当前状态
当前版本：`v0.0.0` 学习基线。

当前仅包含：
- Node.js + TypeScript strict 工程配置；
- Biome 格式化与 lint 配置；
- 一个可构建、可运行的占位 CLI；
- 一个基础测试；
- 产品路线、版本计划和学习协作规则。

当前尚未实现模型调用、`QueryEngine（会话编排器）`、`QueryLoop（单轮智能体循环）`、工具协议、会话系统或权限系统。第一个目标版本是 `v0.1.0`。

## 开始学习
1. 阅读 [学习协作规则](./docs/coding/学习协作规则.md)。
2. 阅读 [v0.1.0 版本计划](./docs/version-plan/v0.1.0.md)。
3. 在查看参考源码前，先画出或写出你预测的最小执行链路。
4. 只查阅当前问题需要的参考源码，并记录预测差异。
5. 自己实现核心类型、主流程、失败路径和关键测试。

## 工程命令
```bash
npm install
npm run build
npm run typecheck
npm run test
npm run start
```

占位入口只会提示从 `v0.1.0` 开始，不包含 Agent 核心答案。

## 当前目录
```text
src/cli/index.ts                   # 不含业务逻辑的占位入口
tests/unit/baseline.test.ts        # 验证测试工具链
docs/coding/学习协作规则.md         # 怎么学、AI 怎么协作
docs/version-plan/                # 按什么版本顺序构建
```

后续目录由每个版本的真实职责逐步长出来，不提前恢复旧实现结构。

## 文档入口
- [CONSTRAINTS.md](./CONSTRAINTS.md)：不可突破的项目约束
- [AGENTS.md](./AGENTS.md)：AI 代理执行流程
- [学习协作规则](./docs/coding/学习协作规则.md)：学习模式、帮助等级和完成标准
- [文档中心](./docs/文档中心.md)：完整文档导航
- [产品说明](./docs/产品说明.md)：产品目标与原则
- [版本总览](./docs/version-plan/版本总览.md)：学习路线与版本边界
