import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSearchFilesTool } from "../../src/tools/searchFiles.js";

async function createTempProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "code-agent-search-files-"));
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), {
    recursive: true
  });
  await fs.writeFile(filePath, content, "utf8");
}

test("search_files: 按路径关键词返回候选文件并按分数排序", async () => {
  const rootDir = await createTempProject();

  try {
    await writeFile(path.join(rootDir, "src/loop/queryLoop.ts"), "export {};");
    await writeFile(path.join(rootDir, "src/app/queryEngine.ts"), "export {};");
    await writeFile(path.join(rootDir, "README.md"), "# demo");

    const tool = createSearchFilesTool({ rootDir });
    const output = await tool.execute({
      query: "query",
      path: ".",
      limit: 10
    });
    const parsed = JSON.parse(output) as {
      results: Array<{ path: string; score: number }>;
      resultCount: number;
      truncated: boolean;
      scanTruncated: boolean;
      resultsTruncated: boolean;
      scannedFilesLimit: number;
    };

    assert.equal(parsed.truncated, false);
    assert.equal(parsed.scanTruncated, false);
    assert.equal(parsed.resultsTruncated, false);
    assert.equal(typeof parsed.scannedFilesLimit, "number");
    assert.ok(parsed.resultCount >= 2);
    assert.ok(parsed.results.some((item) => item.path === "src/app/queryEngine.ts"));
    assert.ok(parsed.results.some((item) => item.path === "src/loop/queryLoop.ts"));
    assert.ok(parsed.results[0].score >= parsed.results[parsed.results.length - 1].score);
  } finally {
    await fs.rm(rootDir, {
      recursive: true,
      force: true
    });
  }
});

test("search_files: 忽略 node_modules，且越界路径会被拒绝", async () => {
  const rootDir = await createTempProject();

  try {
    await writeFile(path.join(rootDir, "node_modules/query/index.js"), "module.exports = {};");
    await writeFile(path.join(rootDir, ".code-agent/query/session.json"), "{}");
    await writeFile(path.join(rootDir, "src/queryable.ts"), "export {};");

    const tool = createSearchFilesTool({ rootDir });

    const output = await tool.execute({
      query: "query",
      path: ".",
      limit: 20,
      includeHidden: true
    });
    const parsed = JSON.parse(output) as {
      results: Array<{ path: string }>;
    };

    assert.equal(parsed.results.some((item) => item.path.startsWith("node_modules/")), false);
    assert.equal(parsed.results.some((item) => item.path.startsWith(".code-agent/")), false);
    assert.ok(parsed.results.some((item) => item.path === "src/queryable.ts"));

    await assert.rejects(
      () =>
        tool.execute({
          query: "query",
          path: "../"
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
