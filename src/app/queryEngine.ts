import { queryLoop } from "../loop/queryLoop.js";
import type { QueryLoopResult } from "../loop/types.js";
import type { AppConfig } from "../core/config.js";
import type { Message } from "../core/message.js";
import type { LlmFunctionTool } from "../llm/types.js";
import { listTools } from "../tools/registry.js";
import type { ToolDefinition } from "../tools/types.js";

/**
 * QueryEngine：一次查询任务的编排层。
 *
 * 当前版本（v0.1.0）职责：
 * 1. 接收用户输入；
 * 2. 组装初始消息与工具协议；
 * 3. 调用 QueryLoop 执行；
 * 4. 返回最终文本结果。
 *
 * 未来版本（多轮会话/权限/上下文）会继续挂在这层，而不是回退到 CLI 层。
 */

/**
 * 当前默认系统提示词。
 *
 * 设计目标：
 * - 让模型优先基于工具结果回答，减少“猜测型回答”；
 * - 保持输出简洁，符合 CLI 使用习惯；
 * - 继续强调 read-only 阶段的行为边界。
 */
const DEFAULT_SYSTEM_PROMPT = [
  "You are a CLI coding assistant helping the user understand the current project.",
  "If you need file contents, call the read_file tool instead of guessing.",
  "Use tool results as source of truth.",
  "Keep final answers concise and practical."
].join(" ");

export type QueryEngineOptions = {
  config: AppConfig;
  toolRegistry: Map<string, ToolDefinition>;
  systemPrompt?: string;
  debug?: boolean;
};

/**
 * 将 Tool Protocol 转为 LLM function tool 协议。
 *
 * 注意：
 * - v0.1.0 只传递模型调用所需字段；
 * - 风险元信息（isReadOnly 等）先保留在 Tool Protocol，
 *   后续权限系统再消费，不在本版提前引入复杂调度逻辑。
 */
function toLlmTools(tools: ToolDefinition[]): LlmFunctionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  }));
}

export class QueryEngine {
  private readonly config: AppConfig;
  private readonly toolRegistry: Map<string, ToolDefinition>;
  private readonly systemPrompt: string;
  private readonly debug: boolean;

  constructor(options: QueryEngineOptions) {
    this.config = options.config;
    this.toolRegistry = options.toolRegistry;
    this.systemPrompt = options.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
    this.debug = options.debug ?? process.env.CODE_AGENT_DEBUG === "1";
  }

  /**
   * 执行一次用户查询，并返回最终文本。
   */
  async run(userInput: string): Promise<string> {
    const prompt = userInput.trim();
    if (!prompt) {
      throw new Error("Prompt is empty. Please provide a question.");
    }

    if (this.debug) {
      console.error(
        `[debug] provider=${this.config.provider} model=${this.config.model} timeoutMs=${this.config.timeoutMs} maxLoops=${this.config.maxAgentLoops}`
      );
    }

    const startedAt = Date.now();
    const initialMessages: Message[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: prompt }
    ];
    const llmTools = toLlmTools(listTools(this.toolRegistry));

    const loopResult: QueryLoopResult = await queryLoop({
      config: this.config,
      messages: initialMessages,
      tools: llmTools,
      toolRegistry: this.toolRegistry,
      debug: this.debug,
      startedAt
    });

    return loopResult.finalText;
  }
}

