import { LoopTerminatedError, ProviderError, ToolExecutionError } from "#src/core/errors.js";
import type { AssistantMessage, Message, ToolMessage } from "#src/core/message.js";
import { createChatCompletion } from "#src/llm/chatClient.js";
import type { LlmFunctionCall, LlmMessage } from "#src/llm/types.js";
import type { QueryDebugEvent, QueryLoopParams, QueryLoopResult } from "#src/loop/types.js";
import type { ToolDefinition } from "#src/tools/types.js";

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
function toLlmMessages(messages: ReadonlyArray<Message>): LlmMessage[] {
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
function printLoopMessageSnapshot(messages: ReadonlyArray<Message>): void {
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
 * 打印“用户可读”的模型决策信息。
 *
 * 输出策略：
 * - 有工具调用：显示调用了哪些工具（模型在行动）；
 * - 无工具调用：显示模型已给出最终答案（模型已收敛）。
 */
function printConversationAssistantDecision(message: LlmMessage, functionCalls: LlmFunctionCall[]): void {
  const content = typeof message.content === "string" ? message.content.trim() : "";
  if (functionCalls.length > 0) {
    const toolNames = functionCalls.map((call) => call.function.name).join("、");
    /**
     * 将“模型决策 + 模型补充”合并为一条日志。
     *
     * 设计原因：
     * - 用户更关心“本轮要做什么”这一条主信息；
     * - 分成两行会增加视觉跳跃，尤其在多轮工具调用时更明显；
     * - 合并后既保留补充信息，又减少日志行数，阅读负担更低。
     */
    if (content) {
      console.error(`[对话] 模型：准备调用工具 ${toolNames}（补充：${toConversationTextPreview(content)}）`);
      return;
    }
    console.error(`[对话] 模型：准备调用工具 ${toolNames}`);
    return;
  }

  if (content) {
    console.error(`[对话] 模型：已给出最终答案（摘要：${toConversationTextPreview(content)}）`);
    return;
  }

  console.error("[对话] 模型：本轮未触发工具，也未给出可读文本。");
}

/**
 * 从工具参数字符串里尽量提取 path 字段。
 *
 * 为什么这里“宽松解析”而不是复用 parseToolArgs：
 * - 该函数只用于“日志展示”，不属于真实执行链路；
 * - 日志层不应因为模型参数临时不规范而抛错，最多降级为通用文案；
 * - 执行阶段仍由 parseToolArgs 严格校验，确保安全与一致性。
 */
function extractPathFromToolArguments(raw: string): string | undefined {
  if (!raw.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const path = (parsed as Record<string, unknown>).path;
    if (typeof path === "string" && path.trim()) {
      return path.trim();
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function extractQueryFromToolArguments(raw: string): string | undefined {
  if (!raw.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const query = (parsed as Record<string, unknown>).query;
    if (typeof query === "string" && query.trim()) {
      return query.trim();
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 生成“用户可读”的工具调用短句。
 *
 * 当前目标风格：
 * - list/search/read 都转成短句动作，降低理解成本；
 * - 其他工具先保留通用回退格式，避免隐藏关键信息。
 */
function formatConversationToolCall(call: LlmFunctionCall): string {
  if (call.function.name === "list_files") {
    const path = extractPathFromToolArguments(call.function.arguments);
    return path ? `[对话] 模型：List ${path}` : "[对话] 模型：List";
  }
  if (call.function.name === "search_files") {
    const query = extractQueryFromToolArguments(call.function.arguments);
    return query ? `[对话] 模型：Search ${query}` : "[对话] 模型：Search";
  }
  if (call.function.name === "read_file") {
    const path = extractPathFromToolArguments(call.function.arguments);
    return path ? `[对话] 模型：Read ${path}` : "[对话] 模型：Read";
  }

  return `[对话] ${call.function.name}(${toConversationTextPreview(call.function.arguments)})`;
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
  /**
   * QueryLoop 只在局部副本上执行消息追加，避免直接修改调用方入参。
   *
   * 设计原因：
   * - 上层（QueryEngine）才是会话状态 owner；
   * - QueryLoop 只负责计算本轮新增消息；
   * - 最终通过 appendedMessages 显式返回给上层合并。
   */
  const workingMessages: Message[] = [...messages];
  const baseMessageCount = messages.length;

  for (let i = 0; i < config.maxAgentLoops; i += 1) {
    emitDebugEvent(params, {
      type: "model_request",
      loopIndex: i + 1,
      messageCount: workingMessages.length,
      toolCount: tools.length
    });

    /**
     * 只有在“使用内置 debug 输出”时才打印消息快照。
     * 若外部注入 onDebugEvent，默认认为由上层接管日志呈现，避免重复输出。
     */
    if (params.debug && !params.onDebugEvent) {
      console.error(`[调试消息] 第${i + 1}轮请求前消息快照：`);
      printLoopMessageSnapshot(workingMessages);
    }

    const response = await requestChatCompletion(config, {
      messages: toLlmMessages(workingMessages),
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
        /**
         * 将最终回答追加到 QueryLoop 的局部工作消息流。
         *
         * 设计原因：
         * - 本轮返回给 QueryEngine 的 `appendedMessages` 需要包含最终 assistant；
         * - QueryLoop 只写局部副本，不直接改调用方入参；
         * - 由 QueryEngine 在上层统一合并进会话状态，保持所有权边界清晰。
         */
        workingMessages.push({
          role: "assistant",
          content: finalText
        });

        if (showConversation) {
          console.error(`[对话] 完成（${i + 1}轮）。`);
        }
        emitDebugEvent(params, {
          type: "loop_completed",
          loopCount: i + 1,
          elapsedMs: Date.now() - startedAt,
          finalTextLength: finalText.length
        });

        return {
          finalText,
          loopCount: i + 1,
          appendedMessages: workingMessages.slice(baseMessageCount)
        };
      }

      throw new ProviderError(`[${config.provider}] 模型未返回最终文本答案。`);
    }

    const nextAssistantMessage: AssistantMessage = {
      role: "assistant",
      content: typeof assistantMessage.content === "string" ? assistantMessage.content : "",
      toolCalls: functionCalls
    };
    workingMessages.push(nextAssistantMessage);

    for (const call of functionCalls) {
      emitDebugEvent(params, {
        type: "tool_call_detected",
        loopIndex: i + 1,
        toolName: call.function.name,
        toolCallId: call.id
      });
      if (showConversation) {
        console.error(formatConversationToolCall(call));
      }
      const toolMessage = await executeToolCall(call, toolRegistry);
      workingMessages.push(toolMessage);
    }

    emitDebugEvent(params, {
      type: "loop_continue",
      loopIndex: i + 1,
      toolCallCount: functionCalls.length,
      messageCount: workingMessages.length
    });
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
