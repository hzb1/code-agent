import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
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

function runNodeCommand(args: string[], extraEnv: Record<string, string> = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1",
        ...extraEnv
      }
    });

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
      resolve({
        code,
        stdout,
        stderr
      });
    });
  });
}

test("searchAndRead: 能完成 search_files -> read_file -> 最终回答链路", async (t) => {
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
                    id: "call-search",
                    type: "function",
                    function: {
                      name: "search_files",
                      arguments: JSON.stringify({ query: "src/cli/index.ts" })
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

    if (requestCount === 2) {
      response.end(
        JSON.stringify({
          id: "resp-2",
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "call-read",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: JSON.stringify({ path: "src/cli/index.ts" })
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
        id: "resp-3",
        choices: [
          {
            message: {
              role: "assistant",
              content: "已完成检索与读取，CLI 入口文件是 src/cli/index.ts。"
            }
          }
        ]
      })
    );
  });

  const listenError = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
    server.once("error", (error) => {
      resolve(error as NodeJS.ErrnoException);
    });
    server.listen(0, "127.0.0.1", () => {
      resolve(null);
    });
  });
  if (listenError) {
    if (listenError.code === "EPERM" || listenError.code === "EACCES") {
      t.skip(`当前环境不允许本地端口监听：${listenError.code}`);
      return;
    }
    throw listenError;
  }

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const result = await runNodeCommand(
      ["--conditions", "source", "--loader", tsxLoaderPath, cliEntryPath, "帮我找 CLI 入口文件"],
      {
        LLM_PROVIDER: "qwen",
        LLM_API_KEY: "test-key",
        LLM_BASE_URL: `http://127.0.0.1:${address.port}`,
        LLM_MODEL: "test-model",
        MAX_AGENT_LOOPS: "5",
        CA_SHOW_CHAT_TRACE: "0"
      }
    );

    assert.equal(result.code, 0);
    assert.match(result.stdout, /CLI 入口文件是 src\/cli\/index\.ts/);
    assert.equal(result.stderr.trim(), "");
    assert.equal(requestCount, 3);
  } finally {
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
