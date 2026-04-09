import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import type { QueryEngine } from "../app/queryEngine.js";
import { SessionStorageCache } from "../session/cache.js";
import { clearLatestSession, saveLatestSession } from "../session/storage.js";
import { printAnswer, printError, printReplHelp, printReplWelcome, printSessionSummary, printSystem } from "./output.js";

const REPL_PROMPT = "ca> ";

export type ReplControlCommand = "none" | "help" | "session" | "last" | "clear" | "exit";

export type StartReplOptions = {
  projectRoot: string;
  restoredFromStorage?: boolean;
  sessionStorageCache?: SessionStorageCache;
};

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
      const rawInput = await rl.question(REPL_PROMPT);
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
        const state = engine.getSessionState();
        try {
          if (state.messageCount > 0) {
            await saveLatestSession(options.projectRoot, engine.exportPersistedSession(), storageCache);
          } else {
            await clearLatestSession(options.projectRoot, storageCache);
          }
        } catch (error) {
          printError(`退出前处理会话失败：${toErrorMessage(error)}`);
        }
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
    rl.close();
  }
}
