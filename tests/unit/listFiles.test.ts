import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createListFilesTool } from "../../src/tools/listFiles.js";

async function createTempProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "code-agent-list-files-"));
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), {
    recursive: true
  });
  await fs.writeFile(filePath, content, "utf8");
}

test("list_files: 列出目录结构并忽略噪音目录", async () => {
  const rootDir = await createTempProject();

  try {
    await writeFile(path.join(rootDir, "src/index.ts"), "export {};");
    await writeFile(path.join(rootDir, "src/app/queryEngine.ts"), "export {};");
    await writeFile(path.join(rootDir, "node_modules/pkg/index.js"), "module.exports = {};");
    await writeFile(path.join(rootDir, ".git/config"), "[core]");
    await writeFile(path.join(rootDir, ".code-agent/session/latest.json"), "{}");

    const tool = createListFilesTool({ rootDir });
    const output = await tool.execute({
      path: ".",
      maxDepth: 3,
      limit: 200,
      includeHidden: true
    });
    const parsed = JSON.parse(output) as {
      entries: Array<{ path: string }>;
      truncated: boolean;
    };

    const listedPaths = parsed.entries.map((entry) => entry.path);
    assert.equal(parsed.truncated, false);
    assert.ok(listedPaths.includes("src"));
    assert.ok(listedPaths.includes("src/index.ts"));
    assert.ok(listedPaths.includes("src/app"));
    assert.equal(listedPaths.some((item) => item.startsWith("node_modules")), false);
    assert.equal(listedPaths.some((item) => item.startsWith(".git")), false);
    assert.equal(listedPaths.some((item) => item.startsWith(".code-agent")), false);
  } finally {
    await fs.rm(rootDir, {
      recursive: true,
      force: true
    });
  }
});

test("list_files: maxDepth 与 limit 生效", async () => {
  const rootDir = await createTempProject();

  try {
    await writeFile(path.join(rootDir, "src/level1/level2/file.ts"), "export {};");
    await writeFile(path.join(rootDir, "src/another.ts"), "export {};");

    const tool = createListFilesTool({ rootDir });

    const depthLimitedOutput = await tool.execute({
      path: "src",
      maxDepth: 1,
      limit: 50
    });
    const depthLimitedParsed = JSON.parse(depthLimitedOutput) as {
      entries: Array<{ path: string }>;
    };
    const depthLimitedPaths = depthLimitedParsed.entries.map((entry) => entry.path);
    assert.ok(depthLimitedPaths.includes("src/level1"));
    assert.equal(depthLimitedPaths.includes("src/level1/level2"), false);

    const limitOutput = await tool.execute({
      path: "src",
      maxDepth: 5,
      limit: 1
    });
    const limitParsed = JSON.parse(limitOutput) as {
      entries: Array<{ path: string }>;
      truncated: boolean;
    };
    assert.equal(limitParsed.entries.length, 1);
    assert.equal(limitParsed.truncated, true);
  } finally {
    await fs.rm(rootDir, {
      recursive: true,
      force: true
    });
  }
});
