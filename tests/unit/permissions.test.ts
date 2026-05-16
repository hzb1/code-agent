import assert from "node:assert/strict";
import test from "node:test";
import { checkToolPermission } from "#src/permissions/check.js";
import type { PermissionContext } from "#src/permissions/types.js";
import type { ToolDefinition } from "#src/tools/types.js";

function createContext(overrides: Partial<PermissionContext> = {}): PermissionContext {
  return {
    projectRoot: "/tmp/project",
    runMode: "normal",
    isPlanApproved: false,
    ...overrides
  };
}

function createTool(overrides: Partial<ToolDefinition>): ToolDefinition {
  return {
    name: "mock_tool",
    description: "mock",
    inputSchema: { type: "object" },
    isReadOnly: true,
    isDestructive: false,
    isConcurrencySafe: true,
    execute: async () => "ok",
    ...overrides
  };
}

test("permissions: 只读工具默认 allow", async () => {
  const decision = await checkToolPermission({
    tool: createTool({ isReadOnly: true }),
    args: {},
    context: createContext()
  });

  assert.equal(decision.behavior, "allow");
});

test("permissions: 非只读工具默认 ask", async () => {
  const decision = await checkToolPermission({
    tool: createTool({ isReadOnly: false, isDestructive: true }),
    args: {},
    context: createContext()
  });

  assert.equal(decision.behavior, "ask");
});

test("permissions: plan 模式拒绝非只读工具", async () => {
  const decision = await checkToolPermission({
    tool: createTool({ name: "write_file", isReadOnly: false, isDestructive: true }),
    args: {},
    context: createContext({ runMode: "plan" })
  });

  assert.equal(decision.behavior, "deny");
  if (decision.behavior === "deny") {
    assert.match(decision.reason, /Plan Mode/);
  }
});

test("permissions: 工具自定义 checkPermissions 优先生效", async () => {
  const decision = await checkToolPermission({
    tool: createTool({
      isReadOnly: false,
      checkPermissions: () => ({
        behavior: "deny",
        reason: "mock deny"
      })
    }),
    args: {},
    context: createContext()
  });

  assert.equal(decision.behavior, "deny");
  if (decision.behavior === "deny") {
    assert.equal(decision.reason, "mock deny");
  }
});
