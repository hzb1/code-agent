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
        NODE_NO_WARNINGS: "1",
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

test("planMode: ca --plan 下写工具会被拒绝，文件不会落地", async (t) => {
  let requestCount = 0;
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }

    requestCount += 1;
    response.writeHead(200, { "Content-Type": "application/json" });
    if (requestCount === 1) {
      response.end(
        JSON.stringify({
          id: "resp-1",
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "call-write-1",
                    type: "function",
                    function: {
                      name: "write_file",
                      arguments: JSON.stringify({
                        path: "should-not-write.txt",
                        content: "hack",
                        overwrite: true
                      })
                    }
                  }
                ]
              }
            }
          ]
        })
      );
      return;
    }

    response.end(
      JSON.stringify({
        id: "resp-2",
        choices: [
          {
            message: {
              role: "assistant",
              content: "计划已完成。"
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

  const tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), "code-agent-plan-mode-"));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const result = await runNodeCommand({
      args: ["--conditions", "source", "--loader", tsxLoaderPath, cliEntryPath, "--plan", "规划重构步骤"],
      cwd: tempCwd,
      env: {
        LLM_PROVIDER: "qwen",
        LLM_API_KEY: "test-key",
        LLM_BASE_URL: `http://127.0.0.1:${address.port}`,
        LLM_MODEL: "test-model",
        MAX_AGENT_LOOPS: "3",
        CA_SHOW_CHAT_TRACE: "0"
      }
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /计划已完成/);
    await assert.rejects(
      () => fs.stat(path.join(tempCwd, "should-not-write.txt")),
      (error) => (error as NodeJS.ErrnoException).code === "ENOENT"
    );
    assert.equal(requestCount, 2);
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

test("planMode: REPL /plan + /approve 后可执行 write_file（需确认）", async (t) => {
  let requestCount = 0;
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }

    requestCount += 1;
    response.writeHead(200, { "Content-Type": "application/json" });

    if (requestCount === 1) {
      response.end(
        JSON.stringify({
          id: "plan-1",
          choices: [
            {
              message: {
                role: "assistant",
                content: "1. 目标\n2. 事实\n3. 修改范围\n4. 风险\n5. 验证"
              }
            }
          ]
        })
      );
      return;
    }

    if (requestCount === 2) {
      response.end(
        JSON.stringify({
          id: "exec-1",
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "call-write-plan",
                    type: "function",
                    function: {
                      name: "write_file",
                      arguments: JSON.stringify({
                        path: "plan-output.txt",
                        content: "approved",
                        overwrite: true
                      })
                    }
                  }
                ]
              }
            }
          ]
        })
      );
      return;
    }

    response.end(
      JSON.stringify({
        id: "exec-2",
        choices: [
          {
            message: {
              role: "assistant",
              content: "执行完成。"
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

  const tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), "code-agent-plan-approve-"));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const result = await new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--conditions", "source", "--loader", tsxLoaderPath, cliEntryPath],
        {
          cwd: tempCwd,
          env: {
            ...process.env,
            NODE_NO_WARNINGS: "1",
            LLM_PROVIDER: "qwen",
            LLM_API_KEY: "test-key",
            LLM_BASE_URL: `http://127.0.0.1:${address.port}`,
            LLM_MODEL: "test-model",
            MAX_AGENT_LOOPS: "4",
            CA_SHOW_CHAT_TRACE: "0"
          }
        }
      );

      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("REPL 交互测试超时。"));
      }, 15_000);

      /**
       * 以分段输入模拟真实用户键入，避免一次性写入多行导致命令在 REPL 异步处理中丢失。
       */
      setTimeout(() => child.stdin.write("/plan 先给计划\n"), 80);
      setTimeout(() => child.stdin.write("/approve\n"), 600);
      setTimeout(() => child.stdin.write("开始执行\n"), 1100);
      setTimeout(() => child.stdin.write("y\n"), 1800);
      setTimeout(() => {
        child.stdin.write("exit\n");
        child.stdin.end();
      }, 2300);

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        resolve({
          code,
          stdout,
          stderr
        });
      });
    });

    assert.equal(result.code, 0);
    assert.match(result.stderr, /已进入 Plan Mode/);
    assert.match(result.stderr, /已批准最近计划/);
    assert.match(result.stderr, /\[权限\] 工具：write_file/);
    assert.match(result.stdout, /执行完成/);

    const created = await fs.readFile(path.join(tempCwd, "plan-output.txt"), "utf8");
    assert.equal(created, "approved");
    assert.equal(requestCount, 3);
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
