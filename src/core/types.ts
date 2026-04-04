export type AgentMessageRole = "system" | "user" | "assistant" | "tool";

// 项目内部统一消息结构，便于在不同模块间传递上下文。
export type AgentMessage = {
  role: AgentMessageRole;
  content: string;
};

// 抽象的工具调用描述：工具名 + 结构化参数。
export type ToolCall = {
  tool: string;
  args: Record<string, unknown>;
};

// 所有工具需满足的最小接口契约。
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
};
