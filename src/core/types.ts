/**
 * 本文件定义项目内部的核心类型契约。
 *
 * 设计目标：
 * 1. 让 agent、tool、llm 层通过统一类型协作，避免“各写各的结构”。
 * 2. 把最容易漂移的数据结构（消息、工具定义）集中管理，降低维护成本。
 * 3. 为后续扩展新工具或新消息形态提供稳定接口，而不影响已有调用方。
 */

/**
 * 统一消息角色集合。
 *
 * 说明：
 * - `system`：系统指令，约束模型行为边界。
 * - `user`：用户输入。
 * - `assistant`：模型回复。
 * - `tool`：工具执行结果回填到对话上下文。
 */
export type AgentMessageRole = "system" | "user" | "assistant" | "tool";

/**
 * 项目内部统一消息结构。
 *
 * 为什么需要这层抽象：
 * - 上游模型协议可能变化，但内部流程只依赖这份最小可用结构。
 * - 对话记录在模块间传递时保持稳定，减少转换代码与边界错误。
 */
export type AgentMessage = {
  role: AgentMessageRole;
  content: string;
};

/**
 * 工具调用描述（简化版）。
 *
 * 说明：
 * - `tool` 是工具标识；
 * - `args` 是结构化参数，使用 `unknown` 防止在入口处误信任外部输入。
 */
export type ToolCall = {
  tool: string;
  args: Record<string, unknown>;
};

/**
 * 所有工具必须遵守的最小接口契约。
 *
 * 设计理由：
 * - 通过统一契约，agent 可以用同一套流程调用不同工具；
 * - 工具实现细节可自由扩展，但对外暴露面保持一致；
 * - `execute` 固定返回字符串，便于直接回填到模型上下文。
 */
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
};
