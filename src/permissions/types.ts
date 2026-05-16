import type { AgentRunMode } from "#src/app/planTypes.js";

/**
 * Permission Model（权限模型）三态结果。
 *
 * 设计目标：
 * - `allow`：可直接执行；
 * - `ask`：需要用户确认；
 * - `deny`：明确拒绝，不进入执行阶段。
 *
 * 这样 QueryLoop 可以在“执行工具前”统一处理风险分支，而不是把确认逻辑散落在工具内部。
 */
export type PermissionDecision =
  | {
      behavior: "allow";
      reason?: string;
    }
  | {
      behavior: "ask";
      reason: string;
      previewTitle?: string;
      previewLines?: string[];
    }
  | {
      behavior: "deny";
      reason: string;
    };

/**
 * 权限上下文（每次工具调用都会携带）。
 *
 * 说明：
 * - `projectRoot`：当前项目根目录，用于边界检查；
 * - `runMode`：普通 / 计划 / 已批准计划；
 * - `isPlanApproved`：是否已批准最近一次计划。
 */
export type PermissionContext = {
  projectRoot: string;
  runMode: AgentRunMode;
  isPlanApproved: boolean;
};

/**
 * 用户确认请求（由 QueryLoop 发给 CLI/REPL 确认层）。
 */
export type PermissionPrompt = {
  toolName: string;
  reason: string;
  previewTitle?: string;
  previewLines?: string[];
};

/**
 * 用户确认函数签名。
 *
 * 返回值：
 * - `true`：允许本次调用；
 * - `false`：拒绝本次调用。
 */
export type PermissionConfirm = (prompt: PermissionPrompt) => Promise<boolean>;
