# Code Agent Learning

这是一个通过亲自实现来学习本地 CLI Coding Agent（命令行编码智能体）的项目。工程设计主要参考本地 `claude-code-fork`，但不复制旧实现。

## 当前状态
项目处于学习起点，目前只有 TypeScript 工程配置、占位 CLI 和基础测试，不具备模型调用、工具执行或会话能力。

现在从“CLI 输入与输出”开始，不使用产品版本号衡量学习进度。

## 开始学习
1. 阅读[学习路线](./docs/学习计划/学习路线.md)，了解知识顺序。
2. 打开[当前阶段](./docs/学习计划/当前阶段.md)，先回答其中三个预测问题。
3. 自己实现核心练习，再运行验证命令。
4. 完成解释、实现、调试和变化题后，更新[学习记录](./docs/学习计划/学习记录.md)。

## 工程命令
```bash
npm install
npm run build
npm run typecheck
npm run test
npm run start
```

## 文档入口
- [CONSTRAINTS.md](./CONSTRAINTS.md)：不可突破的项目约束
- [AGENTS.md](./AGENTS.md)：AI 在仓库中的执行规则
- [学习路线](./docs/学习计划/学习路线.md)：整体知识顺序
- [当前阶段](./docs/学习计划/当前阶段.md)：眼前唯一需要完成的学习任务
- [学习记录](./docs/学习计划/学习记录.md)：已经掌握什么
- [产品说明](./docs/产品说明.md)：最终想做成什么产品
