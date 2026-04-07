import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../../src/core/config.js";
import { ConfigError } from "../../src/core/errors.js";
import { QueryEngine } from "../../src/app/queryEngine.js";
import type { QueryDebugEvent, QueryLoopParams } from "../../src/loop/types.js";
import type { ToolDefinition } from "../../src/tools/types.js";

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

test("QueryEngine: 组装初始消息并调用 QueryLoopRunner", async () => {
  let capturedParams: QueryLoopParams | undefined;
  const engine = new QueryEngine({
    config: createBaseConfig(),
    toolRegistry: createReadOnlyToolRegistry(),
    queryLoopRunner: async (params) => {
      capturedParams = params;
      return {
        finalText: "ok",
        loopCount: 1
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
      loopCount: 1
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
      loopCount: 1
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
