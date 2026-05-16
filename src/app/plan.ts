import type { AgentRunMode } from "#src/app/planTypes.js";

/**
 * Plan Mode（计划模式）系统提示词。
 *
 * 设计目标：
 * - 要求模型输出固定结构，方便用户快速审阅；
 * - 明确“当前只允许探索，不允许修改”；
 * - 强化“先事实、后方案”的输出习惯。
 */
const PLAN_MODE_PROMPT = [
  "你当前处于 Plan Mode（计划模式）。",
  "请先基于工具事实分析，再给出计划，不要执行写入或命令类操作。",
  "请使用以下固定结构输出：",
  "1. 目标",
  "2. 已观察事实",
  "3. 拟修改范围（文件或模块）",
  "4. 风险点",
  "5. 验证方式"
].join("\n");

/**
 * 计划已批准后的系统提示词。
 *
 * 设计目标：
 * - 明确“可以执行”但仍需谨慎；
 * - 引导模型优先小步改动，并在每步后验证。
 */
const PLAN_APPROVED_PROMPT = [
  "用户已批准最近计划，你可以进入执行阶段。",
  "执行时请保持小步修改：先改动，再说明，再验证。",
  "涉及写文件或执行命令时，系统仍会进行权限确认。"
].join("\n");

/**
 * 根据运行模式返回附加系统提示。
 *
 * 返回 `undefined` 表示不需要附加提示（normal 模式）。
 */
export function getRunModeSystemPrompt(runMode: AgentRunMode): string | undefined {
  if (runMode === "plan") {
    return PLAN_MODE_PROMPT;
  }

  if (runMode === "plan-approved") {
    return PLAN_APPROVED_PROMPT;
  }

  return undefined;
}
