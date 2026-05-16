import { spawn } from "node:child_process";
import type { ToolDefinition } from "#src/tools/types.js";

type ExecCommandToolOptions = {
  rootDir: string;
};

type ExecCommandArgs = {
  command: string;
  args: string[];
  timeoutMs: number;
};

type AllowedCommandRule = {
  command: string;
  argsPrefix: string[];
  label: string;
};

type CommandValidationResult =
  | {
      ok: true;
      matchedRule: AllowedCommandRule;
    }
  | {
      ok: false;
      reason: string;
    };

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_CHARS = 12_000;

/**
 * v0.3.0 命令白名单：
 * - 只开放“验证类命令”；
 * - 不开放任意 shell 与系统管理命令。
 */
const ALLOWED_COMMAND_RULES: AllowedCommandRule[] = [
  { command: "npm", argsPrefix: ["run", "build"], label: "npm run build" },
  { command: "npm", argsPrefix: ["run", "typecheck"], label: "npm run typecheck" },
  { command: "npm", argsPrefix: ["run", "test"], label: "npm run test" },
  { command: "npm", argsPrefix: ["run", "test:unit"], label: "npm run test:unit" },
  { command: "npm", argsPrefix: ["run", "test:integration"], label: "npm run test:integration" },
  { command: "npm", argsPrefix: ["run", "lint"], label: "npm run lint" }
];

function parseArgs(rawArgs: Record<string, unknown>): ExecCommandArgs {
  const rawCommand = rawArgs.command;
  if (typeof rawCommand !== "string" || !rawCommand.trim()) {
    throw new Error("exec_command 参数 'command' 必须是非空字符串。");
  }

  const command = rawCommand.trim();
  if (/\s/.test(command)) {
    throw new Error("exec_command 参数 'command' 不能包含空格，请把额外参数放到 args 数组。");
  }

  const rawArgsArray = rawArgs.args;
  if (rawArgsArray !== undefined && !Array.isArray(rawArgsArray)) {
    throw new Error("exec_command 参数 'args' 必须是字符串数组。");
  }

  const args = (rawArgsArray ?? []).map((item) => {
    if (typeof item !== "string") {
      throw new Error("exec_command 参数 'args' 必须全部为字符串。");
    }
    return item;
  });

  const rawTimeout = rawArgs.timeoutMs;
  if (
    rawTimeout !== undefined &&
    (typeof rawTimeout !== "number" || !Number.isInteger(rawTimeout) || rawTimeout <= 0)
  ) {
    throw new Error("exec_command 参数 'timeoutMs' 必须是正整数。");
  }
  const timeoutMs = Math.min(rawTimeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  return {
    command,
    args,
    timeoutMs
  };
}

function validateAllowedCommand(parsed: ExecCommandArgs): CommandValidationResult {
  const matchedRule = ALLOWED_COMMAND_RULES.find((rule) => {
    if (rule.command !== parsed.command) {
      return false;
    }
    if (parsed.args.length < rule.argsPrefix.length) {
      return false;
    }
    return rule.argsPrefix.every((segment, index) => parsed.args[index] === segment);
  });

  if (!matchedRule) {
    const allowList = ALLOWED_COMMAND_RULES.map((rule) => rule.label).join("、");
    return {
      ok: false,
      reason: `命令不在白名单内。当前仅允许：${allowList}。`
    };
  }

  return {
    ok: true,
    matchedRule
  };
}

function appendLimited(current: string, nextChunk: string): { next: string; truncated: boolean } {
  if (current.length >= MAX_OUTPUT_CHARS) {
    return {
      next: current,
      truncated: true
    };
  }

  const remaining = MAX_OUTPUT_CHARS - current.length;
  if (nextChunk.length <= remaining) {
    return {
      next: current + nextChunk,
      truncated: false
    };
  }

  return {
    next: current + nextChunk.slice(0, remaining),
    truncated: true
  };
}

async function runCommand(parsed: ExecCommandArgs, rootDir: string): Promise<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  timedOut: boolean;
  durationMs: number;
}> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(parsed.command, parsed.args, {
      cwd: rootDir,
      shell: false,
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        child.kill("SIGKILL");
      }, 800).unref();
    }, parsed.timeoutMs);

    child.stdout.on("data", (chunk) => {
      const result = appendLimited(stdout, String(chunk));
      stdout = result.next;
      stdoutTruncated = stdoutTruncated || result.truncated;
    });

    child.stderr.on("data", (chunk) => {
      const result = appendLimited(stderr, String(chunk));
      stderr = result.next;
      stderrTruncated = stderrTruncated || result.truncated;
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({
        exitCode: code,
        signal,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        timedOut,
        durationMs: Date.now() - startedAt
      });
    });
  });
}

export function createExecCommandTool(options: ExecCommandToolOptions): ToolDefinition {
  return {
    name: "exec_command",
    description: "执行受白名单约束的验证命令（build/typecheck/test/lint）。",
    isReadOnly: false,
    isDestructive: true,
    isConcurrencySafe: false,
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "可执行命令名，例如 npm。"
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "命令参数数组，例如 ['run', 'build']。"
        },
        timeoutMs: {
          type: "number",
          description: `超时毫秒数，默认 ${DEFAULT_TIMEOUT_MS}，最大 ${MAX_TIMEOUT_MS}。`
        }
      },
      required: ["command"],
      additionalProperties: false
    },
    async checkPermissions({ args }) {
      let parsed: ExecCommandArgs;
      try {
        parsed = parseArgs(args);
      } catch (error) {
        return {
          behavior: "deny",
          reason: error instanceof Error ? error.message : String(error)
        };
      }

      const validation = validateAllowedCommand(parsed);
      if (!validation.ok) {
        return {
          behavior: "deny",
          reason: validation.reason
        };
      }

      const rendered = `${parsed.command} ${parsed.args.join(" ")}`.trim();
      return {
        behavior: "ask",
        reason: `准备执行命令：${validation.matchedRule.label}`,
        previewTitle: "命令执行预览",
        previewLines: [`$ ${rendered}`, `timeoutMs=${parsed.timeoutMs}`]
      };
    },
    async execute(rawArgs) {
      const parsed = parseArgs(rawArgs);
      const validation = validateAllowedCommand(parsed);
      if (!validation.ok) {
        throw new Error(validation.reason);
      }

      const result = await runCommand(parsed, options.rootDir);
      return JSON.stringify(
        {
          command: parsed.command,
          args: parsed.args,
          matchedRule: validation.matchedRule.label,
          timeoutMs: parsed.timeoutMs,
          timedOut: result.timedOut,
          durationMs: result.durationMs,
          exitCode: result.exitCode,
          signal: result.signal,
          stdout: result.stdout,
          stderr: result.stderr,
          stdoutTruncated: result.stdoutTruncated,
          stderrTruncated: result.stderrTruncated
        },
        null,
        2
      );
    }
  };
}
