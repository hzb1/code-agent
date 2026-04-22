import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionStorageCache } from "../../src/session/cache.js";
import { clearLatestSession, getLatestSessionFilePath, loadLatestSession, saveLatestSession } from "../../src/session/storage.js";
import type { PersistedSessionV1 } from "../../src/session/types.js";

function createSnapshot(overrides: Partial<PersistedSessionV1> = {}): PersistedSessionV1 {
  return {
    version: 1,
    sessionId: "session-1",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_111,
    cwd: "/tmp/project",
    model: "test-model",
    turnCount: 2,
    messages: [
      { role: "system", content: "system prompt" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" }
    ],
    ...overrides
  };
}

test("sessionStorage: save/load latest session roundtrip", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "code-agent-session-"));
  const cache = new SessionStorageCache();
  try {
    const snapshot = createSnapshot();
    await saveLatestSession(tempRoot, snapshot, cache);
    const loaded = await loadLatestSession(tempRoot, cache);

    assert.ok(loaded);
    assert.deepEqual(loaded, snapshot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("sessionStorage: latest session 不存在时返回 null", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "code-agent-session-"));
  const cache = new SessionStorageCache();
  try {
    const loaded = await loadLatestSession(tempRoot, cache);
    assert.equal(loaded, null);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("sessionStorage: 会对损坏会话文件给出可读错误", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "code-agent-session-"));
  try {
    const filePath = getLatestSessionFilePath(tempRoot);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "{bad json", "utf8");

    await assert.rejects(
      () => loadLatestSession(tempRoot),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /检测到会话文件损坏/);
        assert.match(error.message, /latest\.json/);
        return true;
      }
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("sessionStorage: latest 路径是目录时会抛出可读错误", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "code-agent-session-"));
  try {
    const filePath = getLatestSessionFilePath(tempRoot);
    await fs.mkdir(filePath, { recursive: true });

    await assert.rejects(
      () => loadLatestSession(tempRoot),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /会话文件路径不是普通文件/);
        return true;
      }
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("sessionStorage: clearLatestSession 会清理文件", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "code-agent-session-"));
  const cache = new SessionStorageCache();
  try {
    await saveLatestSession(tempRoot, createSnapshot(), cache);
    await clearLatestSession(tempRoot, cache);
    const loaded = await loadLatestSession(tempRoot, cache);
    assert.equal(loaded, null);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
