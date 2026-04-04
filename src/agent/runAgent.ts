import { loadConfig } from "../core/config.js";
import type { ToolDefinition } from "../core/types.js";
import {
  createChatCompletion,
  type ChatFunctionCall,
  type ChatFunctionTool,
  type ChatMessage
} from "../llm/chatClient.js";
import { createToolRegistry, listTools } from "../tools/registry.js";

const SYSTEM_PROMPT = [
  "You are a CLI coding assistant helping the user understand the current project.",
  "If you need file contents, call the read_file tool instead of guessing.",
  "Use tool results as source of truth.",
  "Keep final answers concise and practical."
].join(" ");

// 将内部 ToolDefinition 转换为 OpenAI-compatible function tool 结构。
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

// tool_call.arguments 必须是 JSON object，统一在这里做严格校验。
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

// 仅提取合法的 function 类型工具调用，过滤掉不完整或无效项。
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

// 模型最终回复只接受纯文本内容，其它结构在此阶段忽略。
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
  // 工具名不存在时不抛出致命异常，而是把错误反馈给模型继续对话。
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
    // 将工具运行错误封装为 tool 消息，便于模型根据错误再决策。
    const message = error instanceof Error ? error.message : String(error);
    return {
      role: "tool",
      tool_call_id: call.id,
      content: `Tool execution error: ${message}`
    };
  }
}

export async function runAgent(userInput: string): Promise<string> {
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

  // 初始消息固定由 system + user 组成，后续循环持续追加 assistant/tool 消息。
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt }
  ];

  // 受 maxAgentLoops 保护，避免无限循环（安全与稳定性约束）。
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
      // 无工具调用时，视为模型给出最终答案。
      const finalText = extractFinalText(assistantMessage);
      if (finalText) {
        if (debug) {
          console.error(`[debug] completed in ${Date.now() - startedAt}ms`);
        }
        return finalText;
      }

      throw new Error(`[${config.provider}] Model returned no final text answer.`);
    }

    // 保留这轮 assistant 的 tool_calls，上下文供下一轮模型继续推理。
    messages.push({
      role: "assistant",
      content: assistantMessage.content ?? "",
      tool_calls: functionCalls
    });

    for (const call of functionCalls) {
      if (debug) {
        console.error(`[debug] tool_call=${call.function.name}`);
      }
      // 工具调用结果以 tool 角色回填到消息流，形成闭环。
      messages.push(await executeToolCall(call, registry));
    }
  }

  throw new Error(`Reached maximum loop limit (${config.maxAgentLoops}).`);
}
