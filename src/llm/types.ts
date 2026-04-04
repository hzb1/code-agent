/**
 * LLM 协议类型（LLM 层）。
 *
 * 本文件只描述“与 provider 交互时会用到的协议字段”，
 * 不负责业务逻辑，目的是把上游协议与内部消息模型解耦。
 */

/**
 * OpenAI-compatible function tool 定义。
 */
export type LlmFunctionTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/**
 * OpenAI-compatible function call 结构。
 */
export type LlmFunctionCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

/**
 * OpenAI-compatible chat message（精简字段）。
 *
 * 这里保留的是当前项目会消费到的字段。
 * 后续若增加流式或多模态能力，可在本层扩展，而不影响上层核心流程。
 */
export type LlmMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: LlmFunctionCall[];
  tool_call_id?: string;
  name?: string;
};

/**
 * 调用 chat/completions 的请求载荷（当前版本最小集合）。
 */
export type LlmCreateChatCompletionPayload = {
  messages: LlmMessage[];
  tools?: LlmFunctionTool[];
};

/**
 * chat/completions 响应（当前版本最小集合）。
 */
export type LlmChatCompletionResponse = {
  id: string;
  choices?: Array<{
    message?: LlmMessage;
  }>;
  error?: {
    message?: string;
    code?: string;
  };
};

