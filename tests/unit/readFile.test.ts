import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createReadFileTool } from "../../src/tools/readFile.js";

async function createTempProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "code-agent-read-file-"));
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), {
    recursive: true
  });
  await fs.writeFile(filePath, content, "utf8");
}

test("read_file: 正常读取时返回结构化结果与长度信息", async () => {
  const rootDir = await createTempProject();

  try {
    await writeFile(path.join(rootDir, "src/main.ts"), "console.log('hello');");
    const tool = createReadFileTool({
      rootDir,
      maxChars: 100
    });

    const output = await tool.execute({
      path: "src/main.ts"
    });
    const parsed = JSON.parse(output) as {
      path: string;
      resolvedPath: string;
      truncated: boolean;
      originalCharCount: number;
      returnedCharCount: number;
      content: string;
    };

    assert.equal(parsed.path, "src/main.ts");
    assert.equal(parsed.truncated, false);
    assert.equal(parsed.originalCharCount, parsed.returnedCharCount);
    assert.equal(parsed.content, "console.log('hello');");
    assert.ok(parsed.resolvedPath.endsWith(path.join("src", "main.ts")));
  } finally {
    await fs.rm(rootDir, {
      recursive: true,
      force: true
    });
  }
});

test("read_file: 超过 maxChars 时给出截断标记和提示", async () => {
  const rootDir = await createTempProject();

  try {
    const content = "abcdefghijklmnopqrstuvwxyz";
    await writeFile(path.join(rootDir, "README.md"), content);
    const tool = createReadFileTool({
      rootDir,
      maxChars: 10
    });

    const output = await tool.execute({
      path: "README.md"
    });
    const parsed = JSON.parse(output) as {
      truncated: boolean;
      originalCharCount: number;
      returnedCharCount: number;
      truncationHint?: string;
      content: string;
    };

    assert.equal(parsed.truncated, true);
    assert.equal(parsed.originalCharCount, content.length);
    assert.equal(parsed.returnedCharCount, 10);
    assert.match(parsed.truncationHint ?? "", /已截断/);
    assert.equal(parsed.content, content.slice(0, 10));
  } finally {
    await fs.rm(rootDir, {
      recursive: true,
      force: true
    });
  }
});

test("read_file: 文件不存在与路径越界时给出可操作错误", async () => {
  const rootDir = await createTempProject();

  try {
    const tool = createReadFileTool({
      rootDir,
      maxChars: 100
    });

    await assert.rejects(
      () =>
        tool.execute({
          path: "missing.ts"
        }),
      /文件不存在/
    );

    await assert.rejects(
      () =>
        tool.execute({
          path: "../outside.txt"
        }),
      /超出项目根目录范围/
    );
  } finally {
    await fs.rm(rootDir, {
      recursive: true,
      force: true
    });
  }
});
