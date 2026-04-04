import type { AppConfig } from "../core/config.js";
import type { Message } from "../core/message.js";
import type { LlmFunctionTool } from "../llm/types.js";
import type { ToolDefinition } from "../tools/types.js";

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

