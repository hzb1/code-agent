import type { AgentRunMode } from "#src/app/planTypes.js";
import type { PermissionContext } from "#src/permissions/types.js";

/**
 * 创建权限上下文。
 *
 * 设计原因：
 * - 把权限上下文组装集中到一处，避免 QueryEngine/QueryLoop 直接散拼字段；
 * - 后续若新增会话级权限字段（例如临时 allow 列表）可以在此扩展，调用方不需要改动接口形态。
 */
export function createPermissionContext(options: {
  projectRoot: string;
  runMode: AgentRunMode;
  isPlanApproved: boolean;
}): PermissionContext {
  return {
    projectRoot: options.projectRoot,
    runMode: options.runMode,
    isPlanApproved: options.isPlanApproved
  };
}
