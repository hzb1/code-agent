/**
 * 统一消息模型（Core 层）。
 *
 * 为什么在骨架重构阶段单独抽这个文件：
 * 1. 入口层（CLI）、编排层（QueryEngine）、循环层（QueryLoop）都需要共享消息结构；
 * 2. 如果消息结构散落在多个模块，后续加 REPL/多轮会话时会出现协议漂移；
 * 3. 提前稳定角色与字段语义，可以把“流程重构”和“能力扩展”解耦。
 */

/**
 * 当前阶段允许的消息角色。
 *
 * 这四种角色与 OpenAI-compatible chat/completions 的核心语义保持一致，
 * 但这里定义的是“项目内部协议”，后续即使更换 provider 适配也不需要改上层流程。
 */
export type MessageRole = "system" | "user" | "assistant" | "tool";

/**
 * assistant 发起的 function call（内部标准形态）。
 *
 * 说明：
 * - `arguments` 仍保留 string，是为了与上游模型协议保持一致；
 * - 参数 JSON 解析统一放在 QueryLoop 中完成，避免在多个层重复解析逻辑。
 */
export type AssistantToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

/**
 * system 消息：用于约束模型行为边界。
 */
export type SystemMessage = {
  role: "system";
  content: string;
};

/**
 * user 消息：来自用户的原始输入（或后续版本中的用户追问）。
 */
export type UserMessage = {
  role: "user";
  content: string;
};

/**
 * assistant 消息：模型在某轮返回的结果。
 *
 * 说明：
 * - 当 `toolCalls` 为空时，通常代表模型在尝试直接给最终答案；
 * - 当 `toolCalls` 非空时，代表模型要求运行工具，QueryLoop 会继续下一步执行。
 */
export type AssistantMessage = {
  role: "assistant";
  content: string;
  toolCalls?: AssistantToolCall[];
};

/**
 * tool 消息：工具执行结果回填消息。
 *
 * `toolCallId` 用于和 assistant 里对应的 tool call 建立配对关系，
 * 这是让模型在下一轮“知道哪个结果属于哪个调用”的关键字段。
 */
export type ToolMessage = {
  role: "tool";
  content: string;
  toolCallId: string;
};

/**
 * 统一消息联合类型。
 */
export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;
