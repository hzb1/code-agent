import type { PersistedSessionV1 } from "./types.js";

type SessionStorageCacheEntry = {
  filePath: string;
  mtimeMs: number;
  session: PersistedSessionV1;
};

function clonePersistedSession(session: PersistedSessionV1): PersistedSessionV1 {
  return {
    version: session.version,
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    cwd: session.cwd,
    model: session.model,
    turnCount: session.turnCount,
    messages: session.messages.map((message) => {
      if (message.role === "assistant") {
        const clonedToolCalls = message.toolCalls?.map((toolCall) => ({
          id: toolCall.id,
          type: toolCall.type,
          function: {
            name: toolCall.function.name,
            arguments: toolCall.function.arguments
          }
        }));

        /**
         * 为什么这里要按“有值才挂字段”返回：
         * - `toolCalls` 在协议里是可选字段，不是必填字段；
         * - 如果无调用却写成 `toolCalls: undefined`，会污染序列化后的结构一致性；
         * - 会导致 deepEqual/快照测试把“无字段”和“字段为 undefined”识别为不同结构。
         */
        return clonedToolCalls
          ? {
              role: "assistant" as const,
              content: message.content,
              toolCalls: clonedToolCalls
            }
          : {
              role: "assistant" as const,
              content: message.content
            };
      }
      if (message.role === "tool") {
        return {
          role: "tool" as const,
          content: message.content,
          toolCallId: message.toolCallId
        };
      }

      return {
        role: message.role,
        content: message.content
      };
    })
  };
}

/**
 * Session Storage 的轻量内存缓存。
 *
 * v1 设计：
 * - 仅缓存“最近一次读到的 latest session 文件”；
 * - 通过 filePath + mtime 做命中判断；
 * - 不做 LRU/多文件管理，保持最小实现复杂度。
 */
export class SessionStorageCache {
  private entry: SessionStorageCacheEntry | undefined;

  get(filePath: string, mtimeMs: number): PersistedSessionV1 | undefined {
    if (!this.entry) {
      return undefined;
    }
    if (this.entry.filePath !== filePath || this.entry.mtimeMs !== mtimeMs) {
      return undefined;
    }

    return clonePersistedSession(this.entry.session);
  }

  set(filePath: string, mtimeMs: number, session: PersistedSessionV1): void {
    this.entry = {
      filePath,
      mtimeMs,
      session: clonePersistedSession(session)
    };
  }

  clear(): void {
    this.entry = undefined;
  }
}
