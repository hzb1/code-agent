import { LoopTerminatedError, ProviderError, ToolExecutionError } from "../core/errors.js";
import type { AssistantMessage, Message, ToolMessage } from "../core/message.js";
import { createChatCompletion } from "../llm/chatClient.js";
import type { LlmFunctionCall, LlmMessage } from "../llm/types.js";
import type { ToolDefinition } from "../tools/types.js";
import type { QueryLoopParams, QueryLoopResult } from "./types.js";

/**
 * QueryLoop：单轮任务内的核心循环。
 *
 * 循环职责：
 * 1. 把当前消息上下文发送给模型；
 * 2. 识别模型是否发起工具调用；
 * 3. 执行工具并把结果回填到消息流；
 * 4. 判断是否可以返回最终答案。
 *
 * 非职责（由其它层承担）：
 * - 配置加载（Core/CLI）；
 * - 工具注册（Tools Registry）；
 * - 会话级状态管理（未来由 QueryEngine 扩展承接）。
 */

/**
 * 将内部消息模型转换为 LLM 协议消息。
 *
 * 为什么在 QueryLoop 内部做转换：
 * - QueryLoop 同时理解“内部消息”与“LLM 协议”，是最自然的边界点；
 * - 可以避免让 core/message.ts 反向依赖 llm/types.ts。
 */
function toLlmMessages(messages: Message[]): LlmMessage[] {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return {
        role: message.role,
        content: message.content,
        tool_calls: message.toolCalls
      };
    }

    if (message.role === "tool") {
      return {
        role: message.role,
        content: message.content,
        tool_call_id: message.toolCallId
      };
    }

    return {
      role: message.role,
      content: message.content
    };
  });
}

/**
 * 从模型消息中提取合法 function call。
 *
 * 过滤原因：
 * - 模型返回结构可能缺字段或格式异常；
 * - 先做严格过滤，能避免工具层接收到不完整调用导致难排障错误。
 */
function extractFunctionCalls(message: LlmMessage | undefined): LlmFunctionCall[] {
  if (!message?.tool_calls || !Array.isArray(message.tool_calls)) {
    return [];
  }

  return message.tool_calls.filter(
    (call) =>
      call?.type === "function" &&
      typeof call.id === "string" &&
      call.id.trim() !== "" &&
      typeof call.function?.name === "string" &&
      typeof call.function?.arguments === "string"
  );
}

/**
 * 提取模型最终文本答案。
 *
 * 当前版本只接受字符串文本，复杂内容结构将在后续版本再扩展。
 */
function extractFinalText(message: LlmMessage | undefined): string {
  if (!message || typeof message.content !== "string") {
    return "";
  }

  return message.content.trim();
}

/**
 * 解析工具参数字符串。
 *
 * 规则：
 * - 空字符串允许，按空对象处理；
 * - 其余必须是 JSON object；
 * - 数组/原始值一律拒绝，避免工具接口歧义。
 */
function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    return {};
  }

  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ToolExecutionError("工具调用参数必须是 JSON 对象。");
  }

  return parsed as Record<string, unknown>;
}

/**
 * 执行单个工具调用，并将结果包装为 ToolMessage。
 *
 * 设计取舍：
 * - 工具失败不直接中断主循环，而是作为工具结果回填；
 * - 这样模型可以基于失败信息做下一轮修正，提升流程韧性。
 */
async function executeToolCall(call: LlmFunctionCall, registry: Map<string, ToolDefinition>): Promise<ToolMessage> {
  const tool = registry.get(call.function.name);
  if (!tool) {
    return {
      role: "tool",
      toolCallId: call.id,
      content: `工具 '${call.function.name}' 未注册。`
    };
  }

  try {
    const args = parseToolArgs(call.function.arguments);
    const output = await tool.execute(args);
    return {
      role: "tool",
      toolCallId: call.id,
      content: output
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      role: "tool",
      toolCallId: call.id,
      content: `工具执行错误：${message}`
    };
  }
}

/**
 * 运行 QueryLoop，并在“拿到最终文本答案”时结束。
 *
 * 终止条件：
 * - assistant 无 tool call 且返回了非空文本；
 * - 达到 maxAgentLoops（抛出 LoopTerminatedError）。
 */
export async function queryLoop(params: QueryLoopParams): Promise<QueryLoopResult> {
  const { config, messages, tools, toolRegistry, debug, startedAt } = params;

  for (let i = 0; i < config.maxAgentLoops; i += 1) {
    if (debug) {
      console.error(`[调试] 循环=${i + 1}，正在发送模型请求...`);
    }

    const response = await createChatCompletion(config, {
      messages: toLlmMessages(messages),
      tools
    });
    const assistantMessage = response.choices?.[0]?.message;

    if (!assistantMessage) {
      throw new ProviderError(`[${config.provider}] 模型未返回消息。`);
    }

    const functionCalls = extractFunctionCalls(assistantMessage);
    if (functionCalls.length === 0) {
      const finalText = extractFinalText(assistantMessage);
      if (finalText) {
        if (debug) {
          console.error(`[调试] 已完成，总耗时=${Date.now() - startedAt}ms`);
        }

        return {
          finalText,
          loopCount: i + 1
        };
      }

      throw new ProviderError(`[${config.provider}] 模型未返回最终文本答案。`);
    }

    const nextAssistantMessage: AssistantMessage = {
      role: "assistant",
      content: typeof assistantMessage.content === "string" ? assistantMessage.content : "",
      toolCalls: functionCalls
    };
    messages.push(nextAssistantMessage);

    for (const call of functionCalls) {
      if (debug) {
        console.error(`[调试] 检测到工具调用：${call.function.name}`);
      }
      messages.push(await executeToolCall(call, toolRegistry));
    }
  }

  throw new LoopTerminatedError(`已达到最大循环次数限制（${config.maxAgentLoops}）。`);
}
