import { ConfigError } from "../core/errors.js";
import { queryLoop } from "../loop/queryLoop.js";
import type { QueryDebugEvent, QueryDebugEventHandler, QueryLoopResult, QueryLoopRunner } from "../loop/types.js";
import type { AppConfig } from "../core/config.js";
import type { Message } from "../core/message.js";
import type { LlmFunctionTool } from "../llm/types.js";
import { listTools } from "../tools/registry.js";
import type { ToolDefinition } from "../tools/types.js";

/**
 * QueryEngine：一次查询任务的编排层。
 *
 * 当前骨架阶段职责：
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
  "你是一个 CLI 编码助手，负责帮助用户理解当前项目。",
  "当需要文件内容时，请调用 read_file 工具，不要猜测。",
  "请以工具返回结果作为事实依据。",
  "最终回答请简洁、务实、可执行。"
].join(" ");

export type QueryEngineOptions = {
  config: AppConfig;
  toolRegistry: Map<string, ToolDefinition>;
  systemPrompt?: string;
  debug?: boolean;
  showConversation?: boolean;
  onDebugEvent?: QueryDebugEventHandler;
  queryLoopRunner?: QueryLoopRunner;
};

/**
 * 将 Tool Protocol 转为 LLM function tool 协议。
 *
 * 注意：
 * - 当前阶段只传递模型调用所需字段；
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
  private readonly showConversation: boolean;
  private readonly onDebugEvent?: QueryDebugEventHandler;
  private readonly queryLoopRunner: QueryLoopRunner;

  constructor(options: QueryEngineOptions) {
    this.config = options.config;
    this.toolRegistry = options.toolRegistry;
    this.systemPrompt = options.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
    this.debug = options.debug ?? process.env.CODE_AGENT_DEBUG === "1";
    /**
     * 对话过程日志默认开启，满足 CLI 场景下“可见过程”的体验诉求。
     *
     * 关闭方式：
     * - 设置 `CA_SHOW_CHAT_TRACE=0`；
     * - 或在构造 QueryEngine 时显式传 `showConversation: false`。
     */
    this.showConversation = options.showConversation ?? process.env.CA_SHOW_CHAT_TRACE !== "0";
    this.onDebugEvent = options.onDebugEvent;
    this.queryLoopRunner = options.queryLoopRunner ?? queryLoop;
  }

  /**
   * 发出调试事件（QueryEngine 级别）。
   */
  private emitDebugEvent(event: QueryDebugEvent): void {
    if (this.onDebugEvent) {
      this.onDebugEvent(event);
      return;
    }

    if (!this.debug) {
      return;
    }

    if (event.type === "loop_start") {
      console.error(
        `[调试事件] loop_start provider=${event.provider} model=${event.model} maxLoops=${event.maxAgentLoops} timeoutMs=${event.timeoutMs} promptLength=${event.promptLength}`
      );
    }
  }

  /**
   * 执行一次用户查询，并返回最终文本。
   */
  async run(userInput: string): Promise<string> {
    const prompt = userInput.trim();
    if (!prompt) {
      throw new ConfigError("问题为空，请提供要询问的内容。");
    }

    this.emitDebugEvent({
      type: "loop_start",
      promptLength: prompt.length,
      provider: this.config.provider,
      model: this.config.model,
      maxAgentLoops: this.config.maxAgentLoops,
      timeoutMs: this.config.timeoutMs
    });

    const startedAt = Date.now();
    const initialMessages: Message[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: prompt }
    ];
    const llmTools = toLlmTools(listTools(this.toolRegistry));

    const loopResult: QueryLoopResult = await this.queryLoopRunner({
      config: this.config,
      messages: initialMessages,
      tools: llmTools,
      toolRegistry: this.toolRegistry,
      debug: this.debug,
      showConversation: this.showConversation,
      startedAt,
      onDebugEvent: this.onDebugEvent
    });

    return loopResult.finalText;
  }
}
