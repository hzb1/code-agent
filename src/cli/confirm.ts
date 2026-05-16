import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { formatPermissionPreview } from "#src/cli/preview.js";
import type { PermissionConfirm, PermissionPrompt } from "#src/permissions/types.js";

type ConfirmFactoryOptions = {
  ask: (question: string) => Promise<string>;
  print: (line: string) => void;
};

function isAffirmative(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

/**
 * 用“提问函数 + 输出函数”创建权限确认器。
 *
 * 设计原因：
 * - REPL 里可以复用同一个 `readline` 实例，不会出现多实例抢 stdin；
 * - 单次模式也可复用同一逻辑，只是 ask/print 的来源不同。
 */
export function createPermissionConfirm(options: ConfirmFactoryOptions): PermissionConfirm {
  return async (prompt: PermissionPrompt): Promise<boolean> => {
    for (const line of formatPermissionPreview(prompt)) {
      options.print(line);
    }

    const answer = await options.ask("[权限] 是否批准本次操作？(y/N) ");
    return isAffirmative(answer);
  };
}

/**
 * 在普通 CLI 场景下创建确认器（每次确认独立打开 readline）。
 */
export function createStdPermissionConfirm(): PermissionConfirm {
  return async (prompt: PermissionPrompt): Promise<boolean> => {
    const rl = createInterface({
      input: stdin,
      output: stdout
    });

    try {
      const confirm = createPermissionConfirm({
        ask: (question) => rl.question(question),
        print: (line) => console.error(line)
      });
      return await confirm(prompt);
    } finally {
      rl.close();
    }
  };
}
