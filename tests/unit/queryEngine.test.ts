import assert from "node:assert/strict";
import test from "node:test";
import { QueryEngine } from "#src/app/queryEngine.js";
import type { AppConfig } from "#src/core/config.js";
import { ConfigError } from "#src/core/errors.js";
import type { Message } from "#src/core/message.js";
import type { QueryDebugEvent, QueryLoopParams } from "#src/loop/types.js";
import type { PersistedSessionV1 } from "#src/session/types.js";
import type { ToolDefinition } from "#src/tools/types.js";

function createBaseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    projectRoot: "/tmp/project",
    provider: "qwen",
    apiKey: "test-key",
    baseUrl: "https://example.com",
    model: "test-model",
    maxAgentLoops: 5,
    maxFileChars: 10_000,
    timeoutMs: 1200,
    ...overrides
  };
}

function createReadOnlyToolRegistry(): Map<string, ToolDefinition> {
  const tool: ToolDefinition = {
    name: "read_file",
    description: "读取文件",
    inputSchema: {
      type: "object"
    },
    isReadOnly: true,
    isDestructive: false,
    isConcurrencySafe: true,
    execute: async () => "mock"
  };

  return new Map([[tool.name, tool]]);
}

/**
 * 用于测试中的消息快照深拷贝，避免断言阶段受到后续 push 影响。
 */
function cloneMessages(messages: ReadonlyArray<Message>): Message[] {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return {
        role: message.role,
        content: message.content,
        toolCalls: message.toolCalls?.map((toolCall) => ({
          id: toolCall.id,
          type: toolCall.type,
          function: {
            name: toolCall.function.name,
            arguments: toolCall.function.arguments
          }
        }))
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

test("QueryEngine: 组装初始消息并调用 QueryLoopRunner", async () => {
  let capturedParams: QueryLoopParams | undefined;
  const engine = new QueryEngine({
    config: createBaseConfig(),
    toolRegistry: createReadOnlyToolRegistry(),
    queryLoopRunner: async (params) => {
      capturedParams = params;
      return {
        finalText: "ok",
        loopCount: 1,
        appendedMessages: [
          {
            role: "assistant",
            content: "ok"
          }
        ]
      };
    }
  });

  const result = await engine.run("请解释项目");

  assert.equal(result, "ok");
  assert.ok(capturedParams);
  assert.equal(capturedParams.messages[0]?.role, "system");
  assert.equal(capturedParams.messages[1]?.role, "user");
  assert.equal(capturedParams.messages[1]?.content, "请解释项目");
  assert.equal(capturedParams.tools.length, 1);
  assert.equal(capturedParams.tools[0]?.function.name, "read_file");
});

test("QueryEngine: 发出 loop_start 调试事件", async () => {
  const events: QueryDebugEvent[] = [];
  const engine = new QueryEngine({
    config: createBaseConfig(),
    toolRegistry: createReadOnlyToolRegistry(),
    onDebugEvent: (event) => events.push(event),
    queryLoopRunner: async () => ({
      finalText: "ok",
      loopCount: 1,
      appendedMessages: [
        {
          role: "assistant",
          content: "ok"
        }
      ]
    })
  });

  await engine.run("hello");

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "loop_start");
});

test("QueryEngine: 空输入时抛出 ConfigError", async () => {
  const engine = new QueryEngine({
    config: createBaseConfig(),
    toolRegistry: createReadOnlyToolRegistry(),
    queryLoopRunner: async () => ({
      finalText: "ok",
      loopCount: 1,
      appendedMessages: [
        {
          role: "assistant",
          content: "ok"
        }
      ]
    })
  });

  await assert.rejects(
    () => engine.run("   "),
    (error) => {
      assert.ok(error instanceof ConfigError);
      return true;
    }
  );
});

test("QueryEngine: 多轮 runOnce 会保留历史消息", async () => {
  const snapshots: Message[][] = [];
  const engine = new QueryEngine({
    config: createBaseConfig(),
    toolRegistry: createReadOnlyToolRegistry(),
    queryLoopRunner: async (params) => {
      snapshots.push(cloneMessages(params.messages));
      const lastUser = params.messages[params.messages.length - 1];
      const answer =
        lastUser?.role === "user" ? `收到：${lastUser.content}` : "收到：unknown";
      return {
        finalText: answer,
        loopCount: 1,
        appendedMessages: [
          {
            role: "assistant",
            content: answer
          }
        ]
      };
    }
  });

  await engine.runOnce("第一问");
  await engine.runOnce("第二问");

  const messages = engine.getMessages();
  assert.deepEqual(messages.map((message) => message.role), [
    "system",
    "user",
    "assistant",
    "user",
    "assistant"
  ]);
  assert.equal(messages[1]?.content, "第一问");
  assert.equal(messages[2]?.content, "收到：第一问");
  assert.equal(messages[3]?.content, "第二问");
  assert.equal(messages[4]?.content, "收到：第二问");

  assert.equal(snapshots.length, 2);
  assert.deepEqual(snapshots[1]?.map((message) => message.role), ["system", "user", "assistant", "user"]);
  assert.equal(snapshots[1]?.[1]?.content, "第一问");
  assert.equal(snapshots[1]?.[2]?.content, "收到：第一问");
  assert.equal(snapshots[1]?.[3]?.content, "第二问");
});

test("QueryEngine: getMessages 返回深拷贝，外部修改不影响内部状态", async () => {
  const engine = new QueryEngine({
    config: createBaseConfig(),
    toolRegistry: createReadOnlyToolRegistry(),
    queryLoopRunner: async () => ({
      finalText: "ok",
      loopCount: 1,
      appendedMessages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "read_file",
                arguments: "{\"path\":\"README.md\"}"
              }
            }
          ]
        }
      ]
    })
  });

  await engine.runOnce("test");

  const snapshot = engine.getMessages();
  const first = snapshot[0];
  if (first?.role === "system") {
    first.content = "changed";
  }
  const maybeAssistant = snapshot.find((message) => message.role === "assistant");
  if (maybeAssistant?.role === "assistant" && maybeAssistant.toolCalls?.[0]) {
    maybeAssistant.toolCalls[0].function.name = "tampered";
  }

  const internal = engine.getMessages();
  assert.equal(internal[0]?.role, "system");
  if (internal[0]?.role === "system") {
    assert.notEqual(internal[0].content, "changed");
  }
  const internalAssistant = internal.find((message) => message.role === "assistant");
  if (internalAssistant?.role === "assistant" && internalAssistant.toolCalls?.[0]) {
    assert.equal(internalAssistant.toolCalls[0].function.name, "read_file");
  }
});

test("QueryEngine: clearMessages 会清空消息与缓存并重置 turnCount", async () => {
  let runCount = 0;
  const engine = new QueryEngine({
    config: createBaseConfig(),
    toolRegistry: createReadOnlyToolRegistry(),
    queryLoopRunner: async () => {
      runCount += 1;
      const callId = `call-${runCount}`;
      return {
        finalText: "完成",
        loopCount: 2,
        appendedMessages: [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: callId,
                type: "function",
                function: {
                  name: "read_file",
                  arguments: "{\"path\":\"README.md\"}"
                }
              }
            ]
          },
          {
            role: "tool",
            toolCallId: callId,
            content: JSON.stringify({
              path: "README.md",
              resolvedPath: "/tmp/project/README.md",
              truncated: false,
              content: "hello"
            })
          },
          {
            role: "assistant",
            content: "完成"
          }
        ]
      };
    }
  });

  await engine.runOnce("read once");

  const beforeClear = engine.getSessionState();
  assert.equal(beforeClear.turnCount, 1);
  assert.equal(beforeClear.messageCount, 5);
  assert.equal(beforeClear.readOnlyCache.readFiles.length, 1);

  engine.clearMessages();

  const afterClear = engine.getSessionState();
  assert.equal(afterClear.sessionId, beforeClear.sessionId);
  assert.equal(afterClear.turnCount, 0);
  assert.equal(afterClear.messageCount, 0);
  assert.deepEqual(afterClear.readOnlyCache.readFiles, []);
  assert.ok(afterClear.updatedAt >= beforeClear.updatedAt);
});

test("QueryEngine: 会从本轮 read_file 工具结果更新 readOnlyCache", async () => {
  let runCount = 0;
  const engine = new QueryEngine({
    config: createBaseConfig(),
    toolRegistry: createReadOnlyToolRegistry(),
    queryLoopRunner: async () => {
      runCount += 1;
      const callId = `call-${runCount}`;
      const fileContent = runCount === 1 ? "hello" : "hello world";
      return {
        finalText: `完成 ${runCount}`,
        loopCount: 2,
        appendedMessages: [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: callId,
                type: "function",
                function: {
                  name: "read_file",
                  arguments: "{\"path\":\"README.md\"}"
                }
              }
            ]
          },
          {
            role: "tool",
            toolCallId: callId,
            content: JSON.stringify({
              path: "README.md",
              resolvedPath: "/tmp/project/README.md",
              truncated: runCount === 2,
              content: fileContent
            })
          },
          {
            role: "assistant",
            content: `完成 ${runCount}`
          }
        ]
      };
    }
  });

  await engine.runOnce("first");
  await engine.runOnce("second");

  const state = engine.getSessionState();
  assert.equal(state.turnCount, 2);
  assert.equal(state.readOnlyCache.readFiles.length, 1);

  const firstEntry = state.readOnlyCache.readFiles[0];
  assert.equal(firstEntry?.path, "README.md");
  assert.equal(firstEntry?.resolvedPath, "/tmp/project/README.md");
  assert.equal(firstEntry?.readCount, 2);
  assert.equal(firstEntry?.truncated, true);
  assert.equal(firstEntry?.lastContentChars, "hello world".length);
});

test("QueryEngine: 支持从 restoredSession 恢复会话状态", () => {
  const restoredSession: PersistedSessionV1 = {
    version: 1,
    sessionId: "session-restored-1",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_500,
    cwd: "/tmp/project",
    model: "test-model",
    turnCount: 2,
    messages: [
      { role: "system", content: "system prompt" },
      { role: "user", content: "first question" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-restore",
            type: "function",
            function: {
              name: "read_file",
              arguments: "{\"path\":\"README.md\"}"
            }
          }
        ]
      },
      {
        role: "tool",
        toolCallId: "call-restore",
        content: JSON.stringify({
          path: "README.md",
          resolvedPath: "/tmp/project/README.md",
          truncated: false,
          content: "hello"
        })
      },
      { role: "assistant", content: "done" }
    ]
  };

  const engine = new QueryEngine({
    config: createBaseConfig(),
    toolRegistry: createReadOnlyToolRegistry(),
    restoredSession,
    queryLoopRunner: async () => ({
      finalText: "ok",
      loopCount: 1,
      appendedMessages: [{ role: "assistant", content: "ok" }]
    })
  });

  const state = engine.getSessionState();
  assert.equal(state.sessionId, restoredSession.sessionId);
  assert.equal(state.createdAt, restoredSession.createdAt);
  assert.equal(state.updatedAt, restoredSession.updatedAt);
  assert.equal(state.turnCount, restoredSession.turnCount);
  assert.equal(state.messageCount, restoredSession.messages.length);
  assert.equal(state.readOnlyCache.readFiles.length, 1);
  assert.equal(state.readOnlyCache.readFiles[0]?.path, "README.md");
});

test("QueryEngine: exportPersistedSession 返回可持久化快照", async () => {
  const engine = new QueryEngine({
    config: createBaseConfig(),
    toolRegistry: createReadOnlyToolRegistry(),
    queryLoopRunner: async () => ({
      finalText: "ok",
      loopCount: 1,
      appendedMessages: [
        {
          role: "assistant",
          content: "ok"
        }
      ]
    })
  });

  await engine.runOnce("hello");
  const persisted = engine.exportPersistedSession();

  assert.equal(persisted.version, 1);
  assert.equal(typeof persisted.sessionId, "string");
  assert.equal(persisted.cwd, "/tmp/project");
  assert.equal(persisted.model, "test-model");
  assert.equal(persisted.turnCount, 1);
  assert.equal(persisted.messages.length, 3);
  assert.equal(persisted.messages[0]?.role, "system");
  assert.equal(persisted.messages[1]?.role, "user");
  assert.equal(persisted.messages[2]?.role, "assistant");
});

test("QueryEngine: Plan Mode 会记录计划并支持 approve", async () => {
  const engine = new QueryEngine({
    config: createBaseConfig(),
    toolRegistry: createReadOnlyToolRegistry(),
    queryLoopRunner: async () => ({
      finalText: "1. 目标\n2. 事实\n3. 修改范围\n4. 风险\n5. 验证",
      loopCount: 1,
      appendedMessages: [
        {
          role: "assistant",
          content: "1. 目标\n2. 事实\n3. 修改范围\n4. 风险\n5. 验证"
        }
      ]
    })
  });

  engine.enterPlanMode();
  assert.equal(engine.getRunMode(), "plan");
  await engine.runOnce("重构查询链路");

  const beforeApprove = engine.getSessionState();
  assert.equal(beforeApprove.hasLatestPlan, true);
  assert.equal(beforeApprove.isPlanApproved, false);

  const approve = engine.approveLatestPlan();
  assert.equal(approve.ok, true);
  assert.equal(engine.getRunMode(), "plan-approved");

  const afterApprove = engine.getSessionState();
  assert.equal(afterApprove.isPlanApproved, true);
});
