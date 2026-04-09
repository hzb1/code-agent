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

function runNodeCommand(
  args: string[],
  extraEnv: Record<string, string> = {},
  stdinInput?: string
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...extraEnv
      }
    });

    if (typeof stdinInput === "string") {
      child.stdin.write(stdinInput);
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
      resolve({
        code,
        stdout,
        stderr
      });
    });
  });
}

test("readOnlyCli: 未提供问题时进入 REPL，并支持 exit 退出", async () => {
  const result = await runNodeCommand(
    ["--import", "tsx", "src/cli/index.ts"],
    {
      LLM_PROVIDER: "qwen",
      LLM_API_KEY: "test-key",
      LLM_BASE_URL: "https://example.com",
      LLM_MODEL: "test-model"
    },
    "exit\n"
  );

  assert.equal(result.code, 0);
  assert.match(result.stderr, /已进入 REPL 多轮模式/);
  assert.match(result.stderr, /已退出 REPL/);
});

test("readOnlyCli: 能走完真实 CLI -> 假 Provider -> read_file -> 最终答案链路", async () => {
  let requestCount = 0;

  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }

    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });

    request.on("end", () => {
      requestCount += 1;
      const payload = JSON.parse(body) as {
        messages?: Array<{
          role?: string;
          content?: string | null;
          tool_call_id?: string;
        }>;
      };

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
                      id: "call-readme",
                      type: "function",
                      function: {
                        name: "read_file",
                        arguments: JSON.stringify({ path: "README.md" })
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

      const toolMessage = payload.messages?.find((message) => message.role === "tool");
      const finalAnswer =
        typeof toolMessage?.content === "string" && toolMessage.content.includes("Code Agent")
          ? "已读取 README.md，并确认项目名称为 Code Agent。"
          : "已完成读取。";

      response.end(
        JSON.stringify({
          id: "resp-2",
          choices: [
            {
              message: {
                role: "assistant",
                content: finalAnswer
              }
            }
          ]
        })
      );
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const result = await runNodeCommand(["--import", "tsx", "src/cli/index.ts", "解释 README.md"], {
      LLM_PROVIDER: "qwen",
      LLM_API_KEY: "test-key",
      LLM_BASE_URL: `http://127.0.0.1:${address.port}`,
      LLM_MODEL: "test-model",
      MAX_AGENT_LOOPS: "3",
      CA_SHOW_CHAT_TRACE: "0"
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /已读取 README\.md，并确认项目名称为 Code Agent。/);
    assert.equal(result.stderr.trim(), "");
    assert.equal(requestCount, 2);
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
