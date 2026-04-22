import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const projectRoot = path.resolve(currentDir, "../..");
const cliEntryPath = path.join(projectRoot, "src/cli/index.ts");
const tsxLoaderPath = path.join(projectRoot, "node_modules/tsx/dist/loader.mjs");

function runNodeCommand(options: {
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  stdinInput?: string;
}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, options.args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env
      }
    });

    if (typeof options.stdinInput === "string") {
      child.stdin.write(options.stdinInput);
      child.stdin.end();
    }

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test("sessionResume: REPL 退出后可恢复最近会话并继续查看 /last", async (t) => {
  let requestCount = 0;
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }

    requestCount += 1;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        id: `resp-${requestCount}`,
        choices: [
          {
            message: {
              role: "assistant",
              content: "这是第一轮回答。"
            }
          }
        ]
      })
    );
  });

  const listenError = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
    server.once("error", (error) => resolve(error as NodeJS.ErrnoException));
    server.listen(0, "127.0.0.1", () => resolve(null));
  });
  if (listenError) {
    if (listenError.code === "EPERM" || listenError.code === "EACCES") {
      t.skip(`当前环境不允许本地端口监听：${listenError.code}`);
      return;
    }
    throw listenError;
  }

  const tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), "code-agent-repl-resume-"));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const env = {
      LLM_PROVIDER: "qwen",
      LLM_API_KEY: "test-key",
      LLM_BASE_URL: `http://127.0.0.1:${address.port}`,
      LLM_MODEL: "test-model",
      MAX_AGENT_LOOPS: "3",
      CA_SHOW_CHAT_TRACE: "0"
    };

    const firstRun = await runNodeCommand({
      args: ["--import", tsxLoaderPath, cliEntryPath],
      cwd: tempCwd,
      env,
      stdinInput: "第一问\nexit\n"
    });
    assert.equal(firstRun.code, 0);
    assert.match(firstRun.stdout, /这是第一轮回答/);
    assert.match(firstRun.stderr, /已进入 REPL 多轮模式/);
    assert.match(firstRun.stderr, /已退出 REPL/);

    const secondRun = await runNodeCommand({
      args: ["--import", tsxLoaderPath, cliEntryPath],
      cwd: tempCwd,
      env,
      stdinInput: "/session\n/last\nexit\n"
    });
    assert.equal(secondRun.code, 0);
    assert.match(secondRun.stderr, /已恢复最近会话/);
    assert.match(secondRun.stderr, /turns: 1/);
    assert.match(secondRun.stdout, /这是第一轮回答/);

    const latestSessionPath = path.join(tempCwd, ".code-agent/session/latest.json");
    const stat = await fs.stat(latestSessionPath);
    assert.ok(stat.isFile());
    assert.equal(requestCount, 1);
  } finally {
    await fs.rm(tempCwd, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});
