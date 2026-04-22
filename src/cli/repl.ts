import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import type { QueryEngine } from "#src/app/queryEngine.js";
import { printAnswer, printError, printReplHelp, printReplWelcome, printSessionSummary, printSystem } from "#src/cli/output.js";
import { SessionStorageCache } from "#src/session/cache.js";
import { clearLatestSession, saveLatestSession } from "#src/session/storage.js";

const REPL_PROMPT = "ca> ";

export type ReplControlCommand = "none" | "help" | "session" | "last" | "clear" | "exit";

export type StartReplOptions = {
  projectRoot: string;
  restoredFromStorage?: boolean;
  sessionStorageCache?: SessionStorageCache;
};

type ReplCloseReason = "sigint" | "eof";

/**
 * 解析 REPL 控制命令。
 *
 * 设计目标：
 * - 将“命令识别”从主循环中拆开，降低主流程阅读负担；
 * - 该函数只做纯解析，不依赖外部状态，便于单测。
 */
export function parseReplControlCommand(input: string): ReplControlCommand {
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return "none";
  }

  if (normalized === "/help" || normalized === "help") {
    return "help";
  }
  if (normalized === "/session") {
    return "session";
  }
  if (normalized === "/last") {
    return "last";
  }
  if (normalized === "clear" || normalized === "/clear") {
    return "clear";
  }
  if (normalized === "exit" || normalized === "quit" || normalized === "/exit" || normalized === "/quit") {
    return "exit";
  }

  return "none";
}

/**
 * 将未知错误统一转为可读文本。
 */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * 判断异常是否属于“readline 已关闭”这一类可预期中断。
 *
 * 为什么要单独判断：
 * - Ctrl+C / Ctrl+D 本质上不是业务错误，而是用户主动结束交互；
 * - 若把这类中断当成普通异常上抛，会导致 CLI 被误判为失败退出；
 * - 明确识别后可走“保存会话 -> 友好退出”的稳定路径。
 */
export function isReadlineClosedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ERR_USE_AFTER_CLOSE") {
    return true;
  }

  const normalized = error.message.toLowerCase();
  return normalized.includes("readline was closed") || normalized.includes("interface is closed");
}

/**
 * REPL 退出前统一处理会话持久化。
 *
 * 设计意图：
 * - 将“退出前保存/清理 latest session”的逻辑集中，避免多处分支重复；
 * - 无论是 `exit` 命令、Ctrl+C 还是 EOF，都复用同一状态落盘规则；
 * - 失败仅提示，不阻断退出，确保交互不会卡在“退出不了”的状态。
 */
async function persistSessionBeforeExit(
  engine: QueryEngine,
  options: StartReplOptions,
  storageCache: SessionStorageCache
): Promise<void> {
  const state = engine.getSessionState();
  try {
    if (state.messageCount > 0) {
      await saveLatestSession(options.projectRoot, engine.exportPersistedSession(), storageCache);
      return;
    }

    await clearLatestSession(options.projectRoot, storageCache);
  } catch (error) {
    printError(`退出前处理会话失败：${toErrorMessage(error)}`);
  }
}

/**
 * 启动 REPL 会话。
 *
 * 行为边界：
 * - 复用同一个 QueryEngine，保证多轮上下文连续；
 * - 控制命令只处理 REPL 行为，不触发模型请求；
 * - 普通文本输入走 `engine.runOnce`，并即时输出回答。
 */
export async function startRepl(engine: QueryEngine, options: StartReplOptions): Promise<void> {
  const rl = createInterface({
    input: stdin,
    output: stdout
  });
  const storageCache = options.sessionStorageCache ?? new SessionStorageCache();
  let lastAnswer = "";
  let readlineClosed = false;
  let closeReason: ReplCloseReason = "eof";
  const closeMessageByReason: Record<ReplCloseReason, string> = {
    sigint: "已退出 REPL（原因：Ctrl+C）。",
    eof: "已退出 REPL（原因：输入结束）。"
  };

  /**
   * Ctrl+C（SIGINT）走“温和退出”：
   * - 标记关闭原因，便于主循环给出更准确提示；
   * - 主动关闭 readline，让当前 question 立刻结束；
   * - 不直接抛错，避免上层把它当成异常失败。
   */
  rl.on("SIGINT", () => {
    closeReason = "sigint";
    printSystem("检测到 Ctrl+C，准备退出 REPL。");
    rl.close();
  });
  rl.on("close", () => {
    readlineClosed = true;
  });

  printReplWelcome();
  if (options.restoredFromStorage) {
    const state = engine.getSessionState();
    const lastAssistant = [...engine.getMessages()]
      .reverse()
      .find((message) => message.role === "assistant" && message.content.trim().length > 0);
    if (lastAssistant?.role === "assistant") {
      lastAnswer = lastAssistant.content;
    }
    printSystem(`已恢复最近会话（turns=${state.turnCount}, messages=${state.messageCount}）。`);
  }

  try {
    while (true) {
      let rawInput = "";
      try {
        rawInput = await rl.question(REPL_PROMPT);
      } catch (error) {
        if (readlineClosed || isReadlineClosedError(error)) {
          await persistSessionBeforeExit(engine, options, storageCache);
          printSystem(closeMessageByReason[closeReason]);
          return;
        }

        printError(`读取输入失败：${toErrorMessage(error)}。可继续输入或使用 exit 退出。`);
        continue;
      }

      /**
       * 某些终端下 EOF 可能直接关闭 readline，而不是抛异常。
       * 这里补一层兜底判断，确保仍按“正常退出”处理。
       */
      if (readlineClosed) {
        await persistSessionBeforeExit(engine, options, storageCache);
        printSystem(closeMessageByReason[closeReason]);
        return;
      }

      const userInput = rawInput.trim();
      if (!userInput) {
        continue;
      }

      const command = parseReplControlCommand(userInput);
      if (command === "help") {
        printReplHelp();
        continue;
      }
      if (command === "session") {
        printSessionSummary(engine.getSessionState());
        continue;
      }
      if (command === "last") {
        if (!lastAnswer) {
          printSystem("当前没有可回看的回答。");
          continue;
        }
        printAnswer(lastAnswer);
        continue;
      }
      if (command === "clear") {
        engine.clearMessages();
        lastAnswer = "";
        try {
          await clearLatestSession(options.projectRoot, storageCache);
        } catch (error) {
          printError(`清理会话文件失败：${toErrorMessage(error)}`);
        }
        console.clear();
        printSystem("已清空当前会话。");
        continue;
      }
      if (command === "exit") {
        await persistSessionBeforeExit(engine, options, storageCache);
        printSystem("已退出 REPL。");
        return;
      }

      try {
        const answer = await engine.runOnce(userInput);
        lastAnswer = answer;
        try {
          await saveLatestSession(options.projectRoot, engine.exportPersistedSession(), storageCache);
        } catch (error) {
          printError(`保存会话失败：${toErrorMessage(error)}`);
        }
        printAnswer(answer);
      } catch (error) {
        printError(toErrorMessage(error));
      }
    }
  } finally {
    if (!readlineClosed) {
      rl.close();
    }
  }
}
