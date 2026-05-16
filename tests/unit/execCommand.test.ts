import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createExecCommandTool } from "#src/tools/execCommand.js";

async function createTempProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "code-agent-exec-command-"));
}

async function writePackageJson(rootDir: string): Promise<void> {
  const pkg = {
    name: "exec-command-test",
    version: "1.0.0",
    private: true,
    scripts: {
      build: "node -e \"console.log('build ok')\"",
      test: "node -e \"setTimeout(()=>console.log('done'), 5000)\""
    }
  };
  await fs.writeFile(path.join(rootDir, "package.json"), JSON.stringify(pkg, null, 2), "utf8");
}

test("exec_command: 白名单命令返回 ask", async () => {
  const rootDir = await createTempProject();
  try {
    const tool = createExecCommandTool({ rootDir });
    const check = await tool.checkPermissions?.({
      args: {
        command: "npm",
        args: ["run", "build"]
      },
      context: {
        projectRoot: rootDir,
        runMode: "normal",
        isPlanApproved: false
      }
    });

    assert.equal(check?.behavior, "ask");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("exec_command: 非白名单命令 deny", async () => {
  const rootDir = await createTempProject();
  try {
    const tool = createExecCommandTool({ rootDir });
    const check = await tool.checkPermissions?.({
      args: {
        command: "rm",
        args: ["-rf", "/"]
      },
      context: {
        projectRoot: rootDir,
        runMode: "normal",
        isPlanApproved: false
      }
    });

    assert.equal(check?.behavior, "deny");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("exec_command: 执行 npm run build 返回结构化结果", async () => {
  const rootDir = await createTempProject();
  try {
    await writePackageJson(rootDir);
    const tool = createExecCommandTool({ rootDir });
    const output = await tool.execute({
      command: "npm",
      args: ["run", "build"],
      timeoutMs: 10_000
    });

    const parsed = JSON.parse(output) as {
      matchedRule: string;
      exitCode: number | null;
      timedOut: boolean;
      stdout: string;
    };

    assert.equal(parsed.matchedRule, "npm run build");
    assert.equal(parsed.timedOut, false);
    assert.equal(parsed.exitCode, 0);
    assert.match(parsed.stdout, /build ok/);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("exec_command: 超时会返回 timedOut=true", async () => {
  const rootDir = await createTempProject();
  try {
    await writePackageJson(rootDir);
    const tool = createExecCommandTool({ rootDir });
    const output = await tool.execute({
      command: "npm",
      args: ["run", "test"],
      timeoutMs: 50
    });

    const parsed = JSON.parse(output) as {
      timedOut: boolean;
      durationMs: number;
      exitCode: number | null;
    };

    assert.equal(parsed.timedOut, true);
    assert.ok(parsed.durationMs < 5_000);
    assert.ok(parsed.exitCode === null || parsed.exitCode !== 0);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
