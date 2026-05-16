/**
 * Agent 运行模式。
 *
 * - `normal`：普通执行模式；
 * - `plan`：计划模式（只允许只读探索）；
 * - `plan-approved`：用户已批准最近计划，进入可执行阶段。
 */
export type AgentRunMode = "normal" | "plan" | "plan-approved";

/**
 * 最近一次计划快照。
 *
 * 说明：
 * - 这是会话内状态，不落盘；
 * - 主要给 `/approve` 提供“批准目标是否存在”的依据。
 */
export type PlanSnapshot = {
  request: string;
  content: string;
  createdAt: number;
};
