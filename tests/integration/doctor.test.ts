import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

function runNodeCommand(args: string[], extraEnv: Record<string, string> = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
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

test("doctor: 配置完整时返回通过", async () => {
  const result = await runNodeCommand(["--conditions", "source", "--import", "tsx", "src/cli/index.ts", "doctor"], {
    LLM_PROVIDER: "qwen",
    LLM_API_KEY: "test-key",
    LLM_BASE_URL: "https://example.com/v1",
    LLM_MODEL: "test-model"
  });

  assert.equal(result.code, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /\[ca\]\[doctor\] \[通过\] LLM_PROVIDER/);
  assert.match(result.stderr, /诊断结果：通过/);
  assert.match(result.stderr, /403：通常是模型权限\/额度不足/);
});

test("doctor: 配置错误时返回非 0 并给出可操作提示", async () => {
  const result = await runNodeCommand(["--conditions", "source", "--import", "tsx", "src/cli/index.ts", "doctor"], {
    LLM_PROVIDER: "bad-provider",
    LLM_API_KEY: "",
    LLM_BASE_URL: "not-a-url",
    LLM_MODEL: ""
  });

  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /不支持的 provider/);
  assert.match(result.stderr, /URL 格式非法/);
  assert.match(result.stderr, /诊断结果：未通过/);
});
