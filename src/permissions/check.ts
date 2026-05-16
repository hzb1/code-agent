import type { ToolDefinition } from "#src/tools/types.js";
import type { PermissionContext, PermissionDecision } from "#src/permissions/types.js";

/**
 * 统一执行工具权限裁决。
 *
 * 裁决顺序（按优先级）：
 * 1. Plan Mode（计划模式）下拒绝所有非只读工具；
 * 2. 若工具实现了 `checkPermissions`，使用工具自定义裁决；
 * 3. 否则只读工具默认 allow，非只读工具默认 ask。
 *
 * 这样可保证：
 * - 安全基线先执行（计划模式不能修改环境）；
 * - 工具仍可在基线之上给出更细粒度策略（如命令白名单、路径预览）。
 */
export async function checkToolPermission(options: {
  tool: ToolDefinition;
  args: Record<string, unknown>;
  context: PermissionContext;
}): Promise<PermissionDecision> {
  const { tool, args, context } = options;

  if (context.runMode === "plan" && !tool.isReadOnly) {
    return {
      behavior: "deny",
      reason: `当前处于 Plan Mode（计划模式），禁止执行写入或命令工具：${tool.name}。`
    };
  }

  if (tool.checkPermissions) {
    return tool.checkPermissions({
      args,
      context
    });
  }

  if (tool.isReadOnly) {
    return {
      behavior: "allow",
      reason: "只读工具默认允许执行。"
    };
  }

  return {
    behavior: "ask",
    reason: `工具 ${tool.name} 可能修改文件或执行命令，需先确认。`
  };
}
