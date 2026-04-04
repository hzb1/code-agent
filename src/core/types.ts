/**
 * 兼容导出文件（v0.1.0 过渡层）。
 *
 * 背景：
 * - v0.1.0 已将消息与工具协议分别下沉到 `core/message.ts` 和 `tools/types.ts`；
 * - 为了避免一次性重构带来大面积 import 断裂，这里保留“单入口再导出”。
 *
 * 注意：
 * - 新代码应优先直接从目标模块导入；
 * - 本文件未来可在稳定后移除。
 */

export type {
  AssistantMessage,
  AssistantToolCall,
  Message,
  MessageRole,
  SystemMessage,
  ToolMessage,
  UserMessage
} from "./message.js";

export type { ToolDefinition, ToolExecutionArgs, ToolInputSchema } from "../tools/types.js";
