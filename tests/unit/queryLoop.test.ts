import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "#src/core/config.js";
import { LoopTerminatedError } from "#src/core/errors.js";
import type { Message } from "#src/core/message.js";
import type { LlmChatCompletionResponse } from "#src/llm/types.js";
import { queryLoop } from "#src/loop/queryLoop.js";
import type { QueryDebugEvent } from "#src/loop/types.js";
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
    timeoutMs: 1000,
    ...overrides
  };
}

function createInitialMessages(): Message[] {
  return [
    { role: "system", content: "system" },
    { role: "user", content: "user question" }
  ];
}

function createResponse(message: LlmChatCompletionResponse["choices"][number]["message"]): LlmChatCompletionResponse {
  return {
    id: "resp-1",
    choices: [{ message }]
  };
}

test("queryLoop: 无 tool_call 时直接返回最终答案，并发出完成事件", async () => {
  const events: QueryDebugEvent[] = [];
  const messages = createInitialMessages();
  const originalMessages = messages.map((message) => ({ ...message }));

  const result = await queryLoop({
    config: createBaseConfig(),
    messages,
    tools: [],
    toolRegistry: new Map<string, ToolDefinition>(),
    debug: false,
    startedAt: 100,
    onDebugEvent: (event) => events.push(event),
    createChatCompletionFn: async () =>
      createResponse({
        role: "assistant",
        content: "最终答案"
      })
  });

  assert.equal(result.finalText, "最终答案");
  assert.equal(result.loopCount, 1);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages, originalMessages);
  assert.deepEqual(result.appendedMessages, [
    {
      role: "assistant",
      content: "最终答案"
    }
  ]);
  assert.deepEqual(
    events.map((event) => event.type),
    ["model_request", "loop_completed"]
  );
});

test("queryLoop: 检测到 tool_call 后继续循环并回填工具结果", async () => {
  const events: QueryDebugEvent[] = [];
  let requestCount = 0;
  let toolExecuteCount = 0;

  const toolRegistry = new Map<string, ToolDefinition>([
    [
      "read_file",
      {
        name: "read_file",
        description: "测试工具",
        inputSchema: {
          type: "object"
        },
        isReadOnly: true,
        isDestructive: false,
        isConcurrencySafe: true,
        execute: async () => {
          toolExecuteCount += 1;
          return '{"content":"README"}';
        }
      }
    ]
  ]);

  const messages = createInitialMessages();
  const result = await queryLoop({
    config: createBaseConfig(),
    messages,
    tools: [],
    toolRegistry,
    debug: false,
    startedAt: Date.now(),
    onDebugEvent: (event) => events.push(event),
    createChatCompletionFn: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return createResponse({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "read_file",
                arguments: '{"path":"README.md"}'
              }
            }
          ]
        });
      }

      return createResponse({
        role: "assistant",
        content: "读取完成"
      });
    }
  });

  assert.equal(result.finalText, "读取完成");
  assert.equal(result.loopCount, 2);
  assert.equal(requestCount, 2);
  assert.equal(toolExecuteCount, 1);
  assert.equal(messages.length, 2);
  assert.deepEqual(
    result.appendedMessages.map((message) => message.role),
    ["assistant", "tool", "assistant"]
  );
  assert.ok(
    result.appendedMessages.some((message) => message.role === "tool" && message.content.includes("README"))
  );
  assert.equal(result.appendedMessages[2]?.role, "assistant");
  if (result.appendedMessages[2]?.role === "assistant") {
    assert.equal(result.appendedMessages[2].content, "读取完成");
  }
  assert.deepEqual(
    events.map((event) => event.type),
    ["model_request", "tool_call_detected", "loop_continue", "model_request", "loop_completed"]
  );
});

test("queryLoop: 超过最大循环次数时抛出 LoopTerminatedError", async () => {
  await assert.rejects(
    () =>
      queryLoop({
        config: createBaseConfig({ maxAgentLoops: 1 }),
        messages: createInitialMessages(),
        tools: [],
        toolRegistry: new Map<string, ToolDefinition>(),
        debug: false,
        startedAt: Date.now(),
        createChatCompletionFn: async () =>
          createResponse({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call-never-end",
                type: "function",
                function: {
                  name: "unknown_tool",
                  arguments: "{}"
                }
              }
            ]
          })
      }),
    (error) => {
      assert.ok(error instanceof LoopTerminatedError);
      assert.match(
        (error as Error).message,
        /已达到最大循环次数限制（1次）.*MAX_AGENT_LOOPS=1/
      );
      return true;
    }
  );
});
