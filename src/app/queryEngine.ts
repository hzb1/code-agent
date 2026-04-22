import { randomUUID } from "node:crypto";
import type { AppConfig } from "../core/config.js";
import { ConfigError } from "../core/errors.js";
import type { AssistantToolCall, Message } from "../core/message.js";
import type { LlmFunctionTool } from "../llm/types.js";
import { queryLoop } from "../loop/queryLoop.js";
import type { QueryDebugEvent, QueryDebugEventHandler, QueryLoopResult, QueryLoopRunner } from "../loop/types.js";
import type { PersistedSessionV1, QuerySessionState, SessionReadFileCacheEntry } from "../session/types.js";
import { listTools } from "../tools/registry.js";
import type { ToolDefinition } from "../tools/types.js";

/**
 * QueryEngine：一次会话（session）级编排层。
 *
 * 当前版本职责：
 * 1. 维护会话内消息历史（messages）；
 * 2. 维护会话标识与基础元信息（sessionId/cwd/model）；
 * 3. 负责把一次用户输入组装为“可继续的多轮上下文”并驱动 QueryLoop；
 * 4. 暴露会话状态查询与清理接口，供后续 REPL / Session Storage 复用。
 *
 * 这层是“单轮循环（QueryLoop）”与“多轮会话（REPL/恢复）”之间的桥梁。
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
  "当路径不明确时，先使用 list_files 或 search_files，再使用 read_file。",
  "请以工具返回结果作为事实依据。",
  "最终回答请简洁、务实、可执行。"
].join(" ");

export type QueryEngineOptions = {
  config: AppConfig;
  toolRegistry: Map<string, ToolDefinition>;
  restoredSession?: PersistedSessionV1;
  systemPrompt?: string;
  debug?: boolean;
  showConversation?: boolean;
  onDebugEvent?: QueryDebugEventHandler;
  queryLoopRunner?: QueryLoopRunner;
};

/**
 * 读取 read_file 工具结果的最小字段。
 *
 * 注意：
 * - 这里只用于“缓存索引”，不是完整协议定义；
 * - 字段做最小可用校验，保证遇到异常输出时不会影响主流程。
 */
type ReadFileToolResultPayload = {
  path: string;
  resolvedPath: string;
  truncated: boolean;
  returnedCharCount: number;
};

/**
 * 将 Tool Protocol 转为 LLM function tool 协议。
 *
 * 为什么要转换而不是直接暴露 ToolDefinition：
 * - ToolDefinition 里有 execute/isReadOnly 等内部运行字段，不属于 LLM 协议；
 * - LLM 只需要 name/description/parameters 三元组；
 * - 显式转换可以保证层间边界清晰，避免内部字段“泄漏到模型层”。
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

/**
 * 深拷贝 tool call 数组，避免对外暴露可变引用。
 */
function cloneAssistantToolCalls(toolCalls: AssistantToolCall[] | undefined): AssistantToolCall[] | undefined {
  if (!toolCalls) {
    return undefined;
  }

  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    type: toolCall.type,
    function: {
      name: toolCall.function.name,
      arguments: toolCall.function.arguments
    }
  }));
}

/**
 * 深拷贝消息数组，防止调用方意外修改 QueryEngine 内部状态。
 */
function cloneMessages(messages: Message[]): Message[] {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return {
        role: message.role,
        content: message.content,
        toolCalls: cloneAssistantToolCalls(message.toolCalls)
      };
    }
    if (message.role === "tool") {
      return {
        role: message.role,
        content: message.content,
        toolCallId: message.toolCallId
      };
    }

    return {
      role: message.role,
      content: message.content
    };
  });
}

/**
 * 从工具消息内容中解析 read_file 结果。
 *
 * 容错策略：
 * - 解析失败或字段不完整时返回 undefined；
 * - 不抛异常，避免“缓存索引问题”影响主回答链路。
 */
function parseReadFileToolResultPayload(content: string): ReadFileToolResultPayload | undefined {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const candidate = parsed as Record<string, unknown>;
    const filePath = candidate.path;
    const resolvedPath = candidate.resolvedPath;
    const truncated = candidate.truncated;
    const returnedCharCount = candidate.returnedCharCount;
    const fileContent = candidate.content;

    if (typeof filePath !== "string" || typeof resolvedPath !== "string") {
      return undefined;
    }

    /**
     * `read_file` v0.2.1 起会显式返回 returnedCharCount。
     *
     * 兼容策略：
     * - 新字段存在时优先使用，避免依赖 content 字符串本身；
     * - 老版本无该字段时，回退到 `content.length`；
     * - 两者都不可用时按 0 处理，不让缓存索引影响主流程。
     */
    const normalizedReturnedCharCount =
      typeof returnedCharCount === "number" && Number.isFinite(returnedCharCount) && returnedCharCount >= 0
        ? Math.floor(returnedCharCount)
        : typeof fileContent === "string"
          ? fileContent.length
          : 0;

    return {
      path: filePath,
      resolvedPath,
      truncated: typeof truncated === "boolean" ? truncated : false,
      returnedCharCount: normalizedReturnedCharCount
    };
  } catch {
    return undefined;
  }
}

/**
 * 从消息历史里建立 `tool_call_id -> toolName` 索引。
 *
 * 用途：
 * - tool 消息本身只有 toolCallId，没有直接带工具名；
 * - 建索引后可以识别“这条 tool 结果来自哪个工具”。
 */
function buildToolCallNameIndex(messages: Message[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    const toolCalls = message.toolCalls ?? [];
    for (const toolCall of toolCalls) {
      index.set(toolCall.id, toolCall.function.name);
    }
  }

  return index;
}

export class QueryEngine {
  private readonly config: AppConfig;
  private readonly toolRegistry: Map<string, ToolDefinition>;
  private readonly systemPrompt: string;
  private readonly debug: boolean;
  private readonly showConversation: boolean;
  private readonly onDebugEvent?: QueryDebugEventHandler;
  private readonly queryLoopRunner: QueryLoopRunner;

  /**
   * 会话级固定元信息。
   *
   * 说明：
   * - `sessionId` 在引擎生命周期内稳定不变；
   * - `cwd/model` 记录会话运行环境，供 `/session`、恢复与诊断复用。
   */
  private readonly sessionId: string;
  private readonly cwd: string;
  private readonly model: string;
  private readonly createdAt: number;

  /**
   * 会话级可变状态。
   */
  private updatedAt: number;
  private turnCount: number;
  private mutableMessages: Message[];
  private readonly readOnlyFileCache: Map<string, SessionReadFileCacheEntry>;

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
    const restoredSession = options.restoredSession;

    this.sessionId = restoredSession?.sessionId ?? randomUUID();
    this.cwd = this.config.projectRoot;
    this.model = this.config.model;
    this.createdAt = restoredSession?.createdAt ?? Date.now();
    this.updatedAt = restoredSession?.updatedAt ?? this.createdAt;
    this.turnCount = restoredSession?.turnCount ?? 0;
    this.mutableMessages = restoredSession ? cloneMessages(restoredSession.messages) : [];
    this.readOnlyFileCache = new Map<string, SessionReadFileCacheEntry>();

    /**
     * 恢复会话后，立即从历史消息重建 readOnlyCache。
     *
     * 说明：
     * - v1 存储结构不单独落 readOnlyCache，避免冗余；
     * - 重建逻辑复用现有索引函数，保持单一来源。
     */
    if (this.mutableMessages.length > 0) {
      this.updateReadOnlyFileCacheFromNewMessages(0);
    }
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
   * 保证系统消息存在且位于会话消息开头。
   *
   * 设计原因：
   * - 多轮会话不应在每一轮重复插入系统消息；
   * - 同时要保证 clear 后下一轮仍有 system 约束。
   */
  private ensureSystemMessage(): void {
    const firstMessage = this.mutableMessages[0];
    if (firstMessage?.role === "system") {
      return;
    }

    this.mutableMessages.unshift({
      role: "system",
      content: this.systemPrompt
    });
  }

  /**
   * 读取“本轮新增消息”中的 read_file 结果，更新只读缓存索引。
   *
   * 说明：
   * - 当前缓存只追踪 read_file 命中；
   * - 这是最小可行形态，后续可扩展到 list/search 等索引。
   */
  private updateReadOnlyFileCacheFromNewMessages(startIndex: number): void {
    if (startIndex >= this.mutableMessages.length) {
      return;
    }

    const toolCallNameIndex = buildToolCallNameIndex(this.mutableMessages);
    const now = Date.now();

    for (let i = startIndex; i < this.mutableMessages.length; i += 1) {
      const message = this.mutableMessages[i];
      if (message.role !== "tool") {
        continue;
      }

      const toolName = toolCallNameIndex.get(message.toolCallId);
      if (toolName !== "read_file") {
        continue;
      }

      const payload = parseReadFileToolResultPayload(message.content);
      if (!payload) {
        continue;
      }

      const key = payload.resolvedPath;
      const existing = this.readOnlyFileCache.get(key);
      this.readOnlyFileCache.set(key, {
        path: payload.path,
        resolvedPath: payload.resolvedPath,
        truncated: payload.truncated,
        readCount: (existing?.readCount ?? 0) + 1,
        lastReadAt: now,
        lastContentChars: payload.returnedCharCount
      });
    }
  }

  /**
   * 执行一次用户输入（会话内单 turn）。
   *
   * 与 `run()` 的关系：
   * - `runOnce` 是 v0.2.0 会话化后的主入口；
   * - `run` 保留为兼容别名，避免外层调用一次性全改。
   */
  async runOnce(userInput: string): Promise<string> {
    const prompt = userInput.trim();
    if (!prompt) {
      throw new ConfigError("问题为空，请提供要询问的内容。");
    }

    this.ensureSystemMessage();
    this.mutableMessages.push({
      role: "user",
      content: prompt
    });

    this.emitDebugEvent({
      type: "loop_start",
      promptLength: prompt.length,
      provider: this.config.provider,
      model: this.config.model,
      maxAgentLoops: this.config.maxAgentLoops,
      timeoutMs: this.config.timeoutMs
    });

    const startedAt = Date.now();
    /**
     * 传给 QueryLoop 的是消息快照，而不是会话内原始可变引用。
     *
     * 设计原因：
     * - QueryLoop 在新约束下只负责“计算本轮增量”，不直接修改会话状态；
     * - 这样可以把状态应用点统一收敛在 QueryEngine，避免所有权泄漏。
     */
    const loopInputMessages = cloneMessages(this.mutableMessages);
    const llmTools = toLlmTools(listTools(this.toolRegistry));
    const loopResult: QueryLoopResult = await this.queryLoopRunner({
      config: this.config,
      messages: loopInputMessages,
      tools: llmTools,
      toolRegistry: this.toolRegistry,
      debug: this.debug,
      showConversation: this.showConversation,
      startedAt,
      onDebugEvent: this.onDebugEvent
    });

    const newMessageStartIndex = this.mutableMessages.length;
    /**
     * 由 QueryEngine 统一应用 QueryLoop 返回的消息增量。
     *
     * 这一步是状态 owner 的唯一写入点，后续可在这里继续挂持久化与审计逻辑。
     */
    if (loopResult.appendedMessages.length > 0) {
      this.mutableMessages.push(...cloneMessages(loopResult.appendedMessages));
    }

    this.turnCount += 1;
    this.updatedAt = Date.now();
    this.updateReadOnlyFileCacheFromNewMessages(newMessageStartIndex);

    return loopResult.finalText;
  }

  /**
   * 兼容旧调用：`run()` 等价于 `runOnce()`。
   */
  async run(userInput: string): Promise<string> {
    return this.runOnce(userInput);
  }

  /**
   * 获取当前会话消息快照（深拷贝）。
   */
  getMessages(): Message[] {
    return cloneMessages(this.mutableMessages);
  }

  /**
   * 清空会话消息与只读缓存。
   *
   * 设计取舍：
   * - 清空后不保留 system 消息，下一次 runOnce 会自动补回；
   * - sessionId 保持不变，表示“同一会话容器被重置”。
   */
  clearMessages(): void {
    this.mutableMessages = [];
    this.readOnlyFileCache.clear();
    this.turnCount = 0;
    this.updatedAt = Date.now();
  }

  /**
   * 获取会话状态快照。
   */
  getSessionState(): QuerySessionState {
    const readFiles = Array.from(this.readOnlyFileCache.values()).sort((a, b) => b.lastReadAt - a.lastReadAt);

    return {
      sessionId: this.sessionId,
      cwd: this.cwd,
      model: this.model,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      turnCount: this.turnCount,
      messageCount: this.mutableMessages.length,
      readOnlyCache: {
        readFiles
      }
    };
  }

  /**
   * 导出可持久化的会话快照（Session Storage v1）。
   */
  exportPersistedSession(): PersistedSessionV1 {
    return {
      version: 1,
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      cwd: this.cwd,
      model: this.model,
      turnCount: this.turnCount,
      messages: cloneMessages(this.mutableMessages)
    };
  }
}
