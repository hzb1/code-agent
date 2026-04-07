import { LoopTerminatedError, ProviderError, ToolExecutionError } from "../core/errors.js";
import type { AssistantMessage, Message, ToolMessage } from "../core/message.js";
import { createChatCompletion } from "../llm/chatClient.js";
import type { LlmFunctionCall, LlmMessage } from "../llm/types.js";
import type { ToolDefinition } from "../tools/types.js";
import type { QueryDebugEvent, QueryLoopParams, QueryLoopResult } from "./types.js";

/**
 * Debug 日志裁剪阈值。
 *
 * 设计理由：
 * - 用户希望看到循环中的消息，但完整消息可能非常长；
 * - 使用“最近 N 条 + 单条内容摘要”能在可读性和信息量之间取得平衡；
 * - 该阈值只影响调试日志，不影响模型输入与业务行为。
 */
const DEBUG_MAX_LOGGED_MESSAGES = 10;
const DEBUG_PREVIEW_CHARS = 160;
const CONVERSATION_PREVIEW_CHARS = 100;

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
 * 将文本压成单行摘要，避免 debug 日志被超长内容淹没。
 */
function toDebugTextPreview(content: string, maxChars: number = DEBUG_PREVIEW_CHARS): string {
  const singleLine = content.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxChars) {
    return singleLine;
  }

  return `${singleLine.slice(0, maxChars)}...`;
}

/**
 * 面向用户的对话过程摘要：
 * - 比 debug 摘要更短，避免刷屏；
 * - 只保留“读得懂且有决策价值”的信息。
 */
function toConversationTextPreview(content: string, maxChars: number = CONVERSATION_PREVIEW_CHARS): string {
  return toDebugTextPreview(content, maxChars);
}

/**
 * 将一条内部消息渲染为调试可读摘要。
 *
 * 该函数只做展示，不参与协议转换或业务判断。
 */
function toDebugMessageLine(message: Message): string {
  if (message.role === "assistant") {
    const toolCalls = message.toolCalls ?? [];
    const toolCallNames =
      toolCalls.length > 0 ? ` toolCalls=${toolCalls.map((call) => call.function.name).join(",")}` : "";
    return `role=assistant content="${toDebugTextPreview(message.content)}"${toolCallNames}`;
  }

  if (message.role === "tool") {
    return `role=tool toolCallId=${message.toolCallId} content="${toDebugTextPreview(message.content)}"`;
  }

  return `role=${message.role} content="${toDebugTextPreview(message.content)}"`;
}

/**
 * 打印 debug 消息快照（最近若干条）。
 *
 * 这里保留详细快照是为了定位协议/状态问题；
 * 普通用户过程日志不再复用该函数，避免输出过重。
 */
function printLoopMessageSnapshot(messages: Message[]): void {
  if (messages.length > DEBUG_MAX_LOGGED_MESSAGES) {
    console.error(
      `[调试消息] 当前共 ${messages.length} 条消息，仅展示最近 ${DEBUG_MAX_LOGGED_MESSAGES} 条。`
    );
  } else {
    console.error(`[调试消息] 当前共 ${messages.length} 条消息，全部展示。`);
  }

  const startIndex = Math.max(0, messages.length - DEBUG_MAX_LOGGED_MESSAGES);
  for (let i = startIndex; i < messages.length; i += 1) {
    console.error(`[调试消息] #${i + 1} ${toDebugMessageLine(messages[i])}`);
  }
}

/**
 * 打印 debug 视角的模型回复摘要。
 */
function printAssistantReplySummary(loopIndex: number, message: LlmMessage, functionCalls: LlmFunctionCall[]): void {
  const content = typeof message.content === "string" ? toDebugTextPreview(message.content) : "[非文本内容]";
  if (functionCalls.length > 0) {
    console.error(
      `[调试消息] 第${loopIndex}轮模型回复：content="${content}" toolCalls=${functionCalls
        .map((call) => call.function.name)
        .join(",")}`
    );
    return;
  }

  console.error(`[调试消息] 第${loopIndex}轮模型回复：content="${content}"（无 tool_call）`);
}

/**
 * 读取最近一条用户消息，用于在第一轮展示“你问了什么”。
 *
 * 设计原因：
 * - 用户态过程日志应当帮助“快速建立上下文”；
 * - 只在第一轮显示用户问题，可避免每轮重复同一信息。
 */
function getLatestUserMessage(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      return messages[i].content;
    }
  }

  return undefined;
}

/**
 * 打印“用户可读”的轮次起始信息。
 */
function printConversationRoundStart(loopIndex: number, messageCount: number, toolCount: number, userMessage?: string): void {
  console.error(`[对话] 第${loopIndex}轮：请求模型（上下文 ${messageCount} 条，工具 ${toolCount} 个）`);
  if (userMessage) {
    console.error(`[对话] 用户：${toConversationTextPreview(userMessage)}`);
  }
}

/**
 * 打印“用户可读”的模型决策信息。
 *
 * 输出策略：
 * - 有工具调用：显示调用了哪些工具（模型在行动）；
 * - 无工具调用：显示模型已给出最终答案（模型已收敛）。
 */
function printConversationAssistantDecision(message: LlmMessage, functionCalls: LlmFunctionCall[]): void {
  const content = typeof message.content === "string" ? message.content.trim() : "";
  if (functionCalls.length > 0) {
    console.error(`[对话] 模型：准备调用工具 ${functionCalls.map((call) => call.function.name).join("、")}`);
    if (content) {
      console.error(`[对话] 模型补充：${toConversationTextPreview(content)}`);
    }
    return;
  }

  if (content) {
    console.error(`[对话] 模型：已给出最终答案（摘要：${toConversationTextPreview(content)}）`);
    return;
  }

  console.error("[对话] 模型：本轮未触发工具，也未给出可读文本。");
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
 * 统一发出调试事件。
 *
 * 处理策略：
 * - 优先调用外部注入的事件处理器；
 * - 未注入时，若 debug 开启则输出默认日志；
 * - debug 关闭则静默。
 */
function emitDebugEvent(params: QueryLoopParams, event: QueryDebugEvent): void {
  if (params.onDebugEvent) {
    params.onDebugEvent(event);
    return;
  }

  if (!params.debug) {
    return;
  }

  if (event.type === "model_request") {
    console.error(
      `[调试事件] model_request loop=${event.loopIndex} messages=${event.messageCount} tools=${event.toolCount}`
    );
    return;
  }

  if (event.type === "tool_call_detected") {
    console.error(
      `[调试事件] tool_call_detected loop=${event.loopIndex} tool=${event.toolName} callId=${event.toolCallId}`
    );
    return;
  }

  if (event.type === "loop_continue") {
    console.error(
      `[调试事件] loop_continue loop=${event.loopIndex} toolCalls=${event.toolCallCount} messages=${event.messageCount}`
    );
    return;
  }

  if (event.type === "loop_completed") {
    console.error(
      `[调试事件] loop_completed loops=${event.loopCount} elapsedMs=${event.elapsedMs} finalTextLength=${event.finalTextLength}`
    );
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
  const { config, messages, tools, toolRegistry, startedAt } = params;
  const requestChatCompletion = params.createChatCompletionFn ?? createChatCompletion;
  const showConversation = params.showConversation ?? false;

  for (let i = 0; i < config.maxAgentLoops; i += 1) {
    emitDebugEvent(params, {
      type: "model_request",
      loopIndex: i + 1,
      messageCount: messages.length,
      toolCount: tools.length
    });

    if (showConversation) {
      const firstRoundUserMessage = i === 0 ? getLatestUserMessage(messages) : undefined;
      printConversationRoundStart(i + 1, messages.length, tools.length, firstRoundUserMessage);
    }

    /**
     * 只有在“使用内置 debug 输出”时才打印消息快照。
     * 若外部注入 onDebugEvent，默认认为由上层接管日志呈现，避免重复输出。
     */
    if (params.debug && !params.onDebugEvent) {
      console.error(`[调试消息] 第${i + 1}轮请求前消息快照：`);
      printLoopMessageSnapshot(messages);
    }

    const response = await requestChatCompletion(config, {
      messages: toLlmMessages(messages),
      tools
    });
    const assistantMessage = response.choices?.[0]?.message;

    if (!assistantMessage) {
      throw new ProviderError(`[${config.provider}] 模型未返回消息。`);
    }

    const functionCalls = extractFunctionCalls(assistantMessage);
    if (showConversation) {
      printConversationAssistantDecision(assistantMessage, functionCalls);
    }
    if (params.debug && !params.onDebugEvent) {
      printAssistantReplySummary(i + 1, assistantMessage, functionCalls);
    }

    if (functionCalls.length === 0) {
      const finalText = extractFinalText(assistantMessage);
      if (finalText) {
        if (showConversation) {
          console.error(`[对话] 完成：共 ${i + 1} 轮。`);
        }
        emitDebugEvent(params, {
          type: "loop_completed",
          loopCount: i + 1,
          elapsedMs: Date.now() - startedAt,
          finalTextLength: finalText.length
        });

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
      emitDebugEvent(params, {
        type: "tool_call_detected",
        loopIndex: i + 1,
        toolName: call.function.name,
        toolCallId: call.id
      });
      if (showConversation) {
        console.error(
          `[对话] 工具调用：${call.function.name}(${toConversationTextPreview(call.function.arguments)})`
        );
      }
      const toolMessage = await executeToolCall(call, toolRegistry);
      if (showConversation) {
        console.error(`[对话] 工具结果：${call.function.name} -> ${toConversationTextPreview(toolMessage.content)}`);
      }
      messages.push(toolMessage);
    }

    emitDebugEvent(params, {
      type: "loop_continue",
      loopIndex: i + 1,
      toolCallCount: functionCalls.length,
      messageCount: messages.length
    });
    if (showConversation) {
      console.error("[对话] 继续下一轮。");
    }
  }

  /**
   * 失败提示尽量可操作：
   * - 明确告诉用户可以通过 MAX_AGENT_LOOPS 调大上限；
   * - 避免只报“失败”但不给下一步动作，降低排障成本。
   */
  throw new LoopTerminatedError(
    `已达到最大循环次数限制（${config.maxAgentLoops}次）。当前配置 MAX_AGENT_LOOPS=${config.maxAgentLoops}。可在 .env 中调大后重试（例如 12 或 20）。`
  );
}
