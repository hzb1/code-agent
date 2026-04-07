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

function runNodeCommand(args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      env: {
        ...process.env
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

test("readOnlyCli: 未提供问题时输出用法并返回非 0 退出码", async () => {
  const result = await runNodeCommand(["--import", "tsx", "src/cli/index.ts"]);

  assert.equal(result.code, 1);
  assert.equal(result.stdout.trim(), "");
  assert.match(result.stderr, /用法：ca "<问题>"/);
});
