import type { AssistantToolCall, Message } from "../core/message.js";
import type { PersistedSessionV1 } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseAssistantToolCall(raw: unknown, index: number): AssistantToolCall {
  if (!isRecord(raw)) {
    throw new Error(`messages[${index}].toolCalls 项必须是对象。`);
  }

  const id = raw.id;
  const type = raw.type;
  const fn = raw.function;
  if (typeof id !== "string" || !id.trim()) {
    throw new Error(`messages[${index}].toolCalls.id 非法。`);
  }
  if (type !== "function") {
    throw new Error(`messages[${index}].toolCalls.type 仅支持 "function"。`);
  }
  if (!isRecord(fn)) {
    throw new Error(`messages[${index}].toolCalls.function 非法。`);
  }

  const name = fn.name;
  const args = fn.arguments;
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(`messages[${index}].toolCalls.function.name 非法。`);
  }
  if (typeof args !== "string") {
    throw new Error(`messages[${index}].toolCalls.function.arguments 非法。`);
  }

  return {
    id,
    type: "function",
    function: {
      name,
      arguments: args
    }
  };
}

function parseMessage(raw: unknown, index: number): Message {
  if (!isRecord(raw)) {
    throw new Error(`messages[${index}] 必须是对象。`);
  }

  const role = raw.role;
  const content = raw.content;
  if (typeof role !== "string") {
    throw new Error(`messages[${index}].role 非法。`);
  }
  if (typeof content !== "string") {
    throw new Error(`messages[${index}].content 非法。`);
  }

  if (role === "system" || role === "user") {
    return {
      role,
      content
    };
  }

  if (role === "assistant") {
    const rawToolCalls = raw.toolCalls;
    if (rawToolCalls === undefined) {
      return {
        role: "assistant",
        content
      };
    }

    if (!Array.isArray(rawToolCalls)) {
      throw new Error(`messages[${index}].toolCalls 必须是数组。`);
    }

    return {
      role: "assistant",
      content,
      toolCalls: rawToolCalls.map((item) => parseAssistantToolCall(item, index))
    };
  }

  if (role === "tool") {
    const toolCallId = raw.toolCallId;
    if (typeof toolCallId !== "string" || !toolCallId.trim()) {
      throw new Error(`messages[${index}].toolCallId 非法。`);
    }
    return {
      role: "tool",
      content,
      toolCallId
    };
  }

  throw new Error(`messages[${index}].role 不支持：${String(role)}`);
}

/**
 * 将持久化快照序列化为 JSON 文本。
 */
export function serializePersistedSessionV1(snapshot: PersistedSessionV1): string {
  return JSON.stringify(snapshot, null, 2);
}

/**
 * 解析并校验持久化快照（v1）。
 *
 * 校验策略：
 * - 结构不合法时抛出 Error（交给存储层包装可读提示）；
 * - 不做兼容迁移，版本不匹配直接失败。
 */
export function parsePersistedSessionV1(content: string): PersistedSessionV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`会话 JSON 解析失败：${message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("会话数据根节点必须是对象。");
  }

  const version = parsed.version;
  const sessionId = parsed.sessionId;
  const createdAt = parsed.createdAt;
  const updatedAt = parsed.updatedAt;
  const cwd = parsed.cwd;
  const model = parsed.model;
  const turnCount = parsed.turnCount;
  const rawMessages = parsed.messages;

  if (version !== 1) {
    throw new Error(`不支持的会话版本：${String(version)}。`);
  }
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    throw new Error("sessionId 非法。");
  }
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt) || createdAt < 0) {
    throw new Error("createdAt 非法。");
  }
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt) || updatedAt < 0) {
    throw new Error("updatedAt 非法。");
  }
  if (typeof cwd !== "string" || !cwd.trim()) {
    throw new Error("cwd 非法。");
  }
  if (typeof model !== "string" || !model.trim()) {
    throw new Error("model 非法。");
  }
  if (typeof turnCount !== "number" || !Number.isFinite(turnCount) || turnCount < 0) {
    throw new Error("turnCount 非法。");
  }
  if (!Array.isArray(rawMessages)) {
    throw new Error("messages 必须是数组。");
  }

  const messages = rawMessages.map((message, index) => parseMessage(message, index));
  return {
    version: 1,
    sessionId,
    createdAt,
    updatedAt,
    cwd,
    model,
    turnCount,
    messages
  };
}
