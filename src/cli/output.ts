import type { QuerySessionState } from "#src/session/types.js";

/**
 * 统一 CLI 用法提示。
 *
 * 这里把 REPL 与单次提问两种模式都写清楚，避免用户误以为只能单次执行。
 */
export function printUsage(): void {
  console.error("用法：");
  console.error('  ca "<问题>"      单次提问');
  console.error("  ca               进入 REPL 多轮对话");
  console.error("  ca doctor        运行基础诊断");
  console.error("  ca --help        查看帮助");
}

/**
 * 打印 REPL 启动说明。
 *
 * 说明策略：
 * - 第一句告诉用户已进入多轮模式；
 * - 第二句给出最常用退出路径，降低首次使用焦虑；
 * - 其它命令详情交给 `/help`，避免欢迎语过长。
 */
export function printReplWelcome(): void {
  console.error("[ca] 已进入 REPL 多轮模式。");
  console.error("[ca] 输入 /help 查看命令，输入 exit 或 quit 退出。");
}

/**
 * 打印 REPL 帮助命令。
 */
export function printReplHelp(): void {
  console.error("可用命令：");
  console.error("  /help      查看帮助");
  console.error("  /session   查看当前会话摘要");
  console.error("  /last      重新打印最近一次回答");
  console.error("  clear      清空当前会话与屏幕");
  console.error("  exit|quit  退出 REPL");
}

/**
 * 打印通用系统提示。
 */
export function printSystem(message: string): void {
  console.error(`[ca] ${message}`);
}

/**
 * 打印统一错误提示。
 */
export function printError(message: string): void {
  console.error(`[ca] ${message}`);
}

/**
 * 打印模型最终回答。
 *
 * 约定：
 * - 最终回答走 stdout，方便被脚本消费；
 * - 非回答信息（帮助/错误/会话摘要）走 stderr。
 */
export function printAnswer(answer: string): void {
  console.log(answer);
}

/**
 * 打印会话摘要。
 *
 * 当前版本展示最小信息集合：
 * - 会话标识、轮次、消息数；
 * - 最近读取文件数量与前几项文件路径。
 */
export function printSessionSummary(state: QuerySessionState): void {
  console.error(`[ca] sessionId: ${state.sessionId}`);
  console.error(`[ca] cwd: ${state.cwd}`);
  console.error(`[ca] model: ${state.model}`);
  console.error(`[ca] turns: ${state.turnCount}`);
  console.error(`[ca] messages: ${state.messageCount}`);
  console.error(`[ca] readFiles: ${state.readOnlyCache.readFiles.length}`);

  const topFiles = state.readOnlyCache.readFiles.slice(0, 5);
  for (const file of topFiles) {
    console.error(
      `[ca] - ${file.path} (count=${file.readCount}, truncated=${file.truncated ? "yes" : "no"})`
    );
  }
}
