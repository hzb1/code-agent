import type { AppConfig } from "../core/config.js";
import type { Message } from "../core/message.js";
import type { LlmChatCompletionResponse, LlmCreateChatCompletionPayload, LlmFunctionTool } from "../llm/types.js";
import type { ToolDefinition } from "../tools/types.js";

/**
 * QueryLoop/QueryEngine 共用的骨架级调试事件类型。
 *
 * 说明：
 * - 这些事件只用于“执行链路可观测性”，不承担业务功能；
 * - v0.1.1 先固定最小事件集合，后续版本可以在兼容前提下扩展字段。
 */
export type QueryDebugEvent =
  | {
      type: "loop_start";
      promptLength: number;
      provider: AppConfig["provider"];
      model: string;
      maxAgentLoops: number;
      timeoutMs: number;
    }
  | {
      type: "model_request";
      loopIndex: number;
      messageCount: number;
      toolCount: number;
    }
  | {
      type: "tool_call_detected";
      loopIndex: number;
      toolName: string;
      toolCallId: string;
    }
  | {
      type: "loop_continue";
      loopIndex: number;
      toolCallCount: number;
      messageCount: number;
    }
  | {
      type: "loop_completed";
      loopCount: number;
      elapsedMs: number;
      finalTextLength: number;
    };

/**
 * 调试事件回调签名。
 */
export type QueryDebugEventHandler = (event: QueryDebugEvent) => void;

/**
 * QueryLoop 使用的 LLM 请求函数签名。
 *
 * 设计目的：
 * - 让 QueryLoop 在单测中可注入假实现，避免测试直接依赖真实网络；
 * - 生产环境默认仍使用 chatClient 的真实实现。
 */
export type CreateChatCompletionFn = (
  config: AppConfig,
  payload: LlmCreateChatCompletionPayload
) => Promise<LlmChatCompletionResponse>;

/**
 * QueryLoop 输入参数。
 *
 * 职责边界说明：
 * - QueryEngine 负责组装这些参数；
 * - QueryLoop 只消费参数并完成“单次任务内的循环执行”。
 */
export type QueryLoopParams = {
  config: AppConfig;
  messages: Message[];
  tools: LlmFunctionTool[];
  toolRegistry: Map<string, ToolDefinition>;
  debug: boolean;
  startedAt: number;
  createChatCompletionFn?: CreateChatCompletionFn;
  onDebugEvent?: QueryDebugEventHandler;
};

/**
 * QueryLoop 结果。
 *
 * `loopCount` 便于后续做调试/统计，不影响当前功能语义。
 */
export type QueryLoopResult = {
  finalText: string;
  loopCount: number;
};

/**
 * QueryLoop 执行器签名（供 QueryEngine 注入/替换）。
 */
export type QueryLoopRunner = (params: QueryLoopParams) => Promise<QueryLoopResult>;
