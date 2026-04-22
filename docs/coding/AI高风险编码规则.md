# AI 高风险编码规则

这份文档优先给 AI 编码代理使用，只写“最容易犯且代价最高”的问题，不写低价值格式细节。

## 1. 不要制造隐式副作用

函数入参不得原地修改，下层模块不得直接修改上层状态。

应该：
```ts
function appendMessage(messages: ReadonlyArray<Message>, nextMessage: Message): Message[] {
  return [...messages, nextMessage];
}
```

不应该：
```ts
function appendMessage(messages: Message[], nextMessage: Message): Message[] {
  messages.push(nextMessage);
  return messages;
}
```

## 2. 不要为了未来提前抽象

只为当前版本目标写代码。只有重复模式已经明确出现，才抽公共层。

不应该：
- 为未来版本提前做状态机、插件层、通用框架
- 把一个简单流程拆成很多薄封装

## 3. 不要吞错误

错误必须可诊断、可操作，不能静默失败。

应该：
```ts
try {
  return await request();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`请求失败，请检查配置或网络：${message}`);
}
```

不应该：
```ts
try {
  return await request();
} catch {
  return null;
}
```

## 4. 不要用 `any` 逃避类型系统

公共函数、核心流程、协议层函数必须写清楚参数和返回值类型。能用 `ReadonlyArray<T>` 表达只读输入时就明确写出来。不确定字段和返回结构时，先查类型和现有实现，不要猜。

不应该：
```ts
function buildPrompt(input: any): any {
  return input;
}
```

## 5. 不要让改动范围失控

只改当前任务必需的文件。若需要重构，要说明“为什么现在必须重构”，不要借题发挥做大面积整理。

不应该：
- 顺手修改 unrelated 文件
- 把“顺手优化一下”伪装成必要改动

## 6. 不要只测 happy path

测试至少覆盖：
- 正常路径
- 失败路径
- 边界条件
- 副作用约束

高价值例子：
- `QueryLoop` 执行后，传入的 `messages` 没被修改
- 空输入会抛出清晰错误
- 工具失败后错误能被上层感知

## 7. 注释写“为什么”

注释应该解释设计意图、边界和取舍，不要只是翻译代码表面行为。

应该：
```ts
// 传给 QueryLoop 的是消息快照，而不是原始会话引用，
// 这样 QueryEngine 才能保持状态所有权。
const loopInputMessages = cloneMessages(this.mutableMessages);
```

不应该：
```ts
// 复制消息
const loopInputMessages = cloneMessages(this.mutableMessages);
```

## 8. 不要回退到跨目录相对导入

项目内部模块统一使用 `#src/*` 固定别名导入，不要再引入 `../../`、`../` 这类跨目录路径。这样可以避免重构后导入路径大面积失效，也能降低代码阅读成本。

## 提交前自检

1. 有没有原地修改函数入参。
2. 有没有下层直接修改上层状态。
3. 有没有为了未来需求提前抽象。
4. 有没有吞异常或输出不可操作的错误信息。
5. 有没有使用不必要的 `any`。
6. 有没有在不确定协议时靠猜字段名和返回结构写代码。
7. 有没有把改动扩散到当前任务之外。
8. 测试是否覆盖失败路径、边界和副作用。
9. 新增或改动导入时，是否使用了 `#src/*` 固定别名而不是跨目录相对路径。
