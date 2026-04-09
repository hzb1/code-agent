import { promises as fs } from "node:fs";
import path from "node:path";
import type { Stats } from "node:fs";
import type { SessionStorageCache } from "./cache.js";
import { parsePersistedSessionV1, serializePersistedSessionV1 } from "./serializer.js";
import type { PersistedSessionV1 } from "./types.js";

const SESSION_DIR_NAME = ".code-agent";
const SESSION_SUB_DIR_NAME = "session";
const LATEST_SESSION_FILE_NAME = "latest.json";

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

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpFilePath, serializePersistedSessionV1(session), "utf8");
  await fs.rename(tmpFilePath, filePath);

  const stat = await fs.stat(filePath);
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
    throw error;
  }

  if (!stat.isFile()) {
    throw new Error(`会话文件路径不是普通文件：${filePath}`);
  }

  const cached = cache?.get(filePath, stat.mtimeMs);
  if (cached) {
    return cached;
  }

  const content = await fs.readFile(filePath, "utf8");
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
      throw error;
    }
  }

  cache?.clear();
}
