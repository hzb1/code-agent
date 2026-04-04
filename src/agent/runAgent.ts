import { loadConfig } from "../core/config.js";
import type { ToolDefinition } from "../core/types.js";
import {
  createChatCompletion,
  type ChatFunctionCall,
  type ChatFunctionTool,
  type ChatMessage
} from "../llm/chatClient.js";
import { createToolRegistry, listTools } from "../tools/registry.js";

/**
 * 本文件负责 Agent 主循环（LLM -> Tool -> LLM）。
 *
 * 设计目标：
 * - 将“模型调用流程”与“工具实现细节”解耦；
 * - 在有限循环内完成推理，避免无上限调用；
 * - 始终输出可解释结果或可操作错误。
 */
const SYSTEM_PROMPT = [
  "You are a CLI coding assistant helping the user understand the current project.",
  "If you need file contents, call the read_file tool instead of guessing.",
  "Use tool results as source of truth.",
  "Keep final answers concise and practical."
].join(" ");

/**
 * 将内部工具定义转换为 OpenAI-compatible `tools` 协议。
 *
 * 为什么单独抽函数：
 * - 便于后续扩展工具字段而不污染主流程；
 * - 让 `runAgent` 聚焦流程控制，减少认知负担。
 */
function toChatTools(tools: ToolDefinition[]): ChatFunctionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  }));
}

/**
 * 解析并校验工具调用参数。
 *
 * 约束：
 * - 只接受 JSON object；
 * - 空字符串视为空对象（兼容某些模型返回空参数的场景）。
 *
 * 风险控制：
 * - 在入口处失败可以避免工具层收到畸形参数后出现难定位错误。
 */
function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    return {};
  }

  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool call arguments must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

/**
 * 从 assistant 消息中提取合法 tool calls。
 *
 * 过滤策略：
 * - 必须是 `function` 类型；
 * - 必须包含非空 `id`；
 * - 必须包含函数名和参数字符串。
 *
 * 目的：
 * - 先过滤再执行，避免把无效 call 传到工具层导致流程异常。
 */
function extractFunctionCalls(message: ChatMessage | undefined): ChatFunctionCall[] {
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
 * 当前策略：
 * - 仅消费 `string` 形式内容；
 * - 其它复杂结构暂不处理，统一视为“无最终文本”。
 *
 * 这样做的好处是行为可预测；代价是对多模态结构支持有限。
 */
function extractFinalText(message: ChatMessage | undefined): string {
  if (!message) {
    return "";
  }

  if (typeof message.content === "string") {
    return message.content.trim();
  }

  return "";
}

async function executeToolCall(
  call: ChatFunctionCall,
  registry: Map<string, ToolDefinition>
): Promise<ChatMessage> {
  /**
   * 工具名不存在时不抛致命异常，而是将错误作为 tool 消息回传。
   *
   * 目的：
   * - 让模型有机会基于错误继续修正调用；
   * - 避免因为单次无效 call 直接终止整个任务。
   */
  const tool = registry.get(call.function.name);
  if (!tool) {
    return {
      role: "tool",
      tool_call_id: call.id,
      content: `Tool '${call.function.name}' is not registered.`
    };
  }

  try {
    const args = parseToolArgs(call.function.arguments);
    const output = await tool.execute(args);
    return {
      role: "tool",
      tool_call_id: call.id,
      content: output
    };
  } catch (error) {
    /**
     * 工具执行失败同样封装为 tool 消息回填。
     *
     * 设计考虑：
     * - 失败信息进入上下文后，模型可做二次决策（换文件、修参数）；
     * - 用户最终看到的是“可追溯的失败路径”，而非黑盒中断。
     */
    const message = error instanceof Error ? error.message : String(error);
    return {
      role: "tool",
      tool_call_id: call.id,
      content: `Tool execution error: ${message}`
    };
  }
}

export async function runAgent(userInput: string): Promise<string> {
  /**
   * 输入预校验：空问题直接失败，避免发起无意义网络请求。
   */
  const prompt = userInput.trim();
  if (!prompt) {
    throw new Error("Prompt is empty. Please provide a question.");
  }

  const config = loadConfig();
  const debug = process.env.CODE_AGENT_DEBUG === "1";
  const startedAt = Date.now();

  if (debug) {
    console.error(
      `[debug] provider=${config.provider} model=${config.model} timeoutMs=${config.timeoutMs} maxLoops=${config.maxAgentLoops}`
    );
  }
  const registry = createToolRegistry({
    rootDir: config.projectRoot,
    maxFileChars: config.maxFileChars
  });
  const tools = toChatTools(listTools(registry));

  /**
   * 初始消息固定由 `system + user` 组成。
   *
   * 后续每轮都会将 assistant/tool 消息持续追加，形成可回溯的对话历史，
   * 确保模型在下一轮具备完整上下文。
   */
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt }
  ];

  /**
   * 受 `maxAgentLoops` 保护的有限循环。
   *
   * 这是稳定性核心：
   * - 防止模型连续错误调用工具导致无限循环；
   * - 使失败路径可预测（超过上限即退出并报错）。
   */
  for (let i = 0; i < config.maxAgentLoops; i += 1) {
    if (debug) {
      console.error(`[debug] loop=${i + 1} sending request...`);
    }
    const response = await createChatCompletion(config, { messages, tools });
    const assistantMessage = response.choices?.[0]?.message;
    if (!assistantMessage) {
      throw new Error(`[${config.provider}] Model returned no message.`);
    }

    const functionCalls = extractFunctionCalls(assistantMessage);
    if (functionCalls.length === 0) {
      /**
       * 无工具调用时，视为模型已给出最终答案。
       *
       * 若仍提取不到文本，则明确抛错，避免出现“命令执行成功但没有输出”的假成功状态。
       */
      const finalText = extractFinalText(assistantMessage);
      if (finalText) {
        if (debug) {
          console.error(`[debug] completed in ${Date.now() - startedAt}ms`);
        }
        return finalText;
      }

      throw new Error(`[${config.provider}] Model returned no final text answer.`);
    }

    /**
     * 把 assistant 的 tool_calls 原样写回上下文。
     *
     * 目的：
     * - 让下一轮模型知道“自己刚刚调用了哪些工具”；
     * - 与后续 tool 结果形成完整配对，避免上下文断裂。
     */
    messages.push({
      role: "assistant",
      content: assistantMessage.content ?? "",
      tool_calls: functionCalls
    });

    for (const call of functionCalls) {
      if (debug) {
        console.error(`[debug] tool_call=${call.function.name}`);
      }
      /**
       * 工具调用结果以 `tool` 角色回填到消息流，构成闭环：
       * assistant 发起调用 -> tool 返回结果 -> assistant 基于结果继续推理。
       */
      messages.push(await executeToolCall(call, registry));
    }
  }

  /**
   * 超过循环上限仍未收敛时，主动失败并给出明确原因。
   * 这样比“继续重试直到超时”更可控、也更易排障。
   */
  throw new Error(`Reached maximum loop limit (${config.maxAgentLoops}).`);
}
