/**
 * Tool Protocol（工具协议层）。
 *
 * v0.1.0 目标是把“工具是什么、如何被调用、风险级别如何表达”统一下来，
 * 这样 QueryLoop/QueryEngine 在调用工具时就能依赖稳定契约。
 */

/**
 * 工具输入 Schema（JSON Schema 的最小子集）。
 *
 * 说明：
 * - 当前只要求 object 作为顶层；
 * - 通过开放索引字段兼容更多 JSON Schema 扩展字段；
 * - 后续可按版本计划逐步收严。
 */
export type ToolInputSchema = {
  [key: string]: unknown;
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

/**
 * 工具执行参数（运行时统一入口类型）。
 */
export type ToolExecutionArgs = Record<string, unknown>;

/**
 * 统一工具定义协议。
 *
 * 元信息字段解释：
 * - `isReadOnly`：是否只读（不修改文件/环境）；
 * - `isDestructive`：是否可能带来不可逆影响；
 * - `isConcurrencySafe`：是否可并发执行且结果可预期。
 *
 * 这些字段在 v0.1.0 先完成协议定义与基础标注，
 * 后续版本再接入权限系统与调度策略。
 */
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  isReadOnly: boolean;
  isDestructive: boolean;
  isConcurrencySafe: boolean;
  execute: (args: ToolExecutionArgs) => Promise<string>;
};

