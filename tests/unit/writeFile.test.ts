import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWriteFileTool } from "#src/tools/writeFile.js";

async function createTempProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "code-agent-write-file-"));
}

async function readUtf8(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

test("write_file: 新建文件时需 ask，执行后写入成功", async () => {
  const rootDir = await createTempProject();
  try {
    const tool = createWriteFileTool({ rootDir });
    const check = await tool.checkPermissions?.({
      args: {
        path: "notes/todo.txt",
        content: "hello"
      },
      context: {
        projectRoot: rootDir,
        runMode: "normal",
        isPlanApproved: false
      }
    });

    assert.equal(check?.behavior, "ask");

    const output = await tool.execute({
      path: "notes/todo.txt",
      content: "hello"
    });
    const parsed = JSON.parse(output) as {
      created: boolean;
      overwritten: boolean;
      path: string;
    };

    assert.equal(parsed.path, "notes/todo.txt");
    assert.equal(parsed.created, true);
    assert.equal(parsed.overwritten, false);
    assert.equal(await readUtf8(path.join(rootDir, "notes/todo.txt")), "hello");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("write_file: 目标存在且 overwrite=false 时拒绝", async () => {
  const rootDir = await createTempProject();
  try {
    const target = path.join(rootDir, "README.md");
    await fs.writeFile(target, "old", "utf8");
    const tool = createWriteFileTool({ rootDir });

    const check = await tool.checkPermissions?.({
      args: {
        path: "README.md",
        content: "new",
        overwrite: false
      },
      context: {
        projectRoot: rootDir,
        runMode: "normal",
        isPlanApproved: false
      }
    });

    assert.equal(check?.behavior, "deny");
    await assert.rejects(
      () =>
        tool.execute({
          path: "README.md",
          content: "new",
          overwrite: false
        }),
      /目标文件已存在/
    );
    assert.equal(await readUtf8(target), "old");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("write_file: overwrite=true 时覆盖并返回 diff 摘要", async () => {
  const rootDir = await createTempProject();
  try {
    const target = path.join(rootDir, "src/main.ts");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "console.log('old');\n", "utf8");

    const tool = createWriteFileTool({ rootDir });
    const check = await tool.checkPermissions?.({
      args: {
        path: "src/main.ts",
        content: "console.log('new');\n",
        overwrite: true
      },
      context: {
        projectRoot: rootDir,
        runMode: "normal",
        isPlanApproved: true
      }
    });

    assert.equal(check?.behavior, "ask");

    const output = await tool.execute({
      path: "src/main.ts",
      content: "console.log('new');\n",
      overwrite: true
    });
    const parsed = JSON.parse(output) as {
      created: boolean;
      overwritten: boolean;
      changed: boolean;
      diffSummary: string;
    };
    assert.equal(parsed.created, false);
    assert.equal(parsed.overwritten, true);
    assert.equal(parsed.changed, true);
    assert.match(parsed.diffSummary, /新增|删除|变更/);
    assert.equal(await readUtf8(target), "console.log('new');\n");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("write_file: 越界路径直接 deny", async () => {
  const rootDir = await createTempProject();
  try {
    const tool = createWriteFileTool({ rootDir });
    const check = await tool.checkPermissions?.({
      args: {
        path: "../outside.txt",
        content: "hack"
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
