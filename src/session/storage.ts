import { promises as fs } from "node:fs";
import path from "node:path";
import type { Stats } from "node:fs";
import type { SessionStorageCache } from "#src/session/cache.js";
import { parsePersistedSessionV1, serializePersistedSessionV1 } from "#src/session/serializer.js";
import type { PersistedSessionV1 } from "#src/session/types.js";

const SESSION_DIR_NAME = ".code-agent";
const SESSION_SUB_DIR_NAME = "session";
const LATEST_SESSION_FILE_NAME = "latest.json";

type SessionStorageStage = "mkdir" | "write" | "rename" | "stat" | "read" | "unlink";

/**
 * 将底层文件系统异常转换成可操作的中文提示。
 *
 * 设计原因：
 * - Session Storage 是 REPL 稳定性的关键路径，错误提示必须可直接排障；
 * - 原始 errno 对大多数用户并不友好，需要在存储层提前翻译；
 * - 统一文案后，CLI/测试都能基于同一语义做处理。
 */
function toReadableStorageErrorMessage(stage: SessionStorageStage, filePath: string, error: unknown): string {
  const errno = error as NodeJS.ErrnoException;
  const code = errno.code;

  if (code === "EACCES" || code === "EPERM") {
    return `会话存储失败：没有权限访问 ${filePath}。请检查目录权限。`;
  }

  if (code === "EISDIR") {
    return `会话存储失败：目标路径是目录而不是文件（${filePath}）。`;
  }

  const actionText =
    stage === "mkdir"
      ? "创建会话目录"
      : stage === "write"
        ? "写入会话临时文件"
        : stage === "rename"
          ? "替换 latest 会话文件"
          : stage === "stat"
            ? "读取会话文件状态"
            : stage === "read"
              ? "读取会话文件内容"
              : "删除会话文件";
  const message = error instanceof Error ? error.message : String(error);
  return `会话存储失败：${actionText}时发生错误（${filePath}）。${message}`;
}

/**
 * 获取 latest session 文件路径。
 */
export function getLatestSessionFilePath(projectRoot: string): string {
  return path.join(projectRoot, SESSION_DIR_NAME, SESSION_SUB_DIR_NAME, LATEST_SESSION_FILE_NAME);
}

/**
 * 保存 latest session（覆盖写）。
 *
 * 写入策略：
 * - 先写临时文件，再 rename 覆盖目标文件；
 * - 避免中途写入失败导致目标文件半截内容。
 */
export async function saveLatestSession(
  projectRoot: string,
  session: PersistedSessionV1,
  cache?: SessionStorageCache
): Promise<string> {
  const filePath = getLatestSessionFilePath(projectRoot);
  const dir = path.dirname(filePath);
  const tmpFilePath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    throw new Error(toReadableStorageErrorMessage("mkdir", dir, error));
  }

  /**
   * 原子写入策略：
   * 1. 先写 `.tmp-*` 文件；
   * 2. 再通过 rename 覆盖 latest.json；
   * 3. 如果中途失败，尽量清理临时文件，避免目录被残留文件污染。
   */
  let writeCompleted = false;
  let renamed = false;
  try {
    await fs.writeFile(tmpFilePath, serializePersistedSessionV1(session), "utf8");
    writeCompleted = true;
    await fs.rename(tmpFilePath, filePath);
    renamed = true;
  } catch (error) {
    const stage: SessionStorageStage = writeCompleted ? "rename" : "write";
    throw new Error(toReadableStorageErrorMessage(stage, filePath, error));
  } finally {
    if (!renamed) {
      try {
        await fs.unlink(tmpFilePath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        /**
         * 清理失败不覆盖主错误：
         * - 主错误通常来自 write/rename，诊断价值更高；
         * - 清理异常作为次要信息，避免把真实失败原因“吞掉”。
         */
        if (code !== "ENOENT") {
          // ignore
        }
      }
    }
  }

  let stat: Stats;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    throw new Error(toReadableStorageErrorMessage("stat", filePath, error));
  }

  cache?.set(filePath, stat.mtimeMs, session);
  return filePath;
}

/**
 * 读取 latest session。
 *
 * 返回值：
 * - 不存在 -> `null`
 * - 存在且合法 -> `PersistedSessionV1`
 * - 存在但损坏 -> 抛出可读错误（由上层决定是否忽略）
 */
export async function loadLatestSession(
  projectRoot: string,
  cache?: SessionStorageCache
): Promise<PersistedSessionV1 | null> {
  const filePath = getLatestSessionFilePath(projectRoot);

  let stat: Stats;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw new Error(toReadableStorageErrorMessage("stat", filePath, error));
  }

  if (!stat.isFile()) {
    throw new Error(`会话文件路径不是普通文件：${filePath}`);
  }

  const cached = cache?.get(filePath, stat.mtimeMs);
  if (cached) {
    return cached;
  }

  let content = "";
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(toReadableStorageErrorMessage("read", filePath, error));
  }

  try {
    const parsed = parsePersistedSessionV1(content);
    cache?.set(filePath, stat.mtimeMs, parsed);
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`检测到会话文件损坏：${filePath}。${message}。可删除该文件后重试。`);
  }
}

/**
 * 清理 latest session 文件。
 */
export async function clearLatestSession(projectRoot: string, cache?: SessionStorageCache): Promise<void> {
  const filePath = getLatestSessionFilePath(projectRoot);

  try {
    await fs.unlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw new Error(toReadableStorageErrorMessage("unlink", filePath, error));
    }
  }

  cache?.clear();
}
