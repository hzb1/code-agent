import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import type { ToolDefinition } from "./types.js";

/**
 * list_files 工具：
 * - 负责“列出目录结构”；
 * - 不负责关键词匹配（由 search_files 负责）；
 * - 输出结构化 JSON，便于模型做下一步工具决策。
 */

type ListFilesToolOptions = {
  rootDir: string;
};

type ListFilesArgs = {
  path: string;
  maxDepth: number;
  limit: number;
  includeHidden: boolean;
};

type ListedEntry = {
  path: string;
  kind: "file" | "directory";
  depth: number;
};

/**
 * 默认参数与硬上限。
 *
 * 设计说明：
 * - `maxDepth` 默认 2，优先给模型“可读的目录骨架”而不是一次性刷全盘；
 * - `limit` 默认 200，避免单次结果过大占用 token；
 * - 提供上限是为了防止模型/用户误传超大值导致响应失控。
 */
const DEFAULT_MAX_DEPTH = 2;
const MAX_ALLOWED_DEPTH = 8;
const DEFAULT_LIMIT = 200;
const MAX_ALLOWED_LIMIT = 1_000;

/**
 * 噪音目录默认忽略集合。
 *
 * 原因：
 * - 这些目录通常体积大、信息噪音高；
 * - 在“代码理解”场景里优先级低，默认跳过可显著提高结果质量。
 */
const NOISY_DIRECTORY_NAMES = new Set([
  ".code-agent",
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo"
]);

function parsePositiveIntInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  fieldName: string
): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`list_files 参数 '${fieldName}' 必须是整数。`);
  }
  if (value < min || value > max) {
    throw new Error(`list_files 参数 '${fieldName}' 必须在 ${min} 到 ${max} 之间。`);
  }

  return value;
}

/**
 * 解析并校验 list_files 入参。
 *
 * 关键点：
 * - `path` 可选，缺省为当前项目根目录（`.`）；
 * - `maxDepth/limit` 有默认值，也有明确范围限制；
 * - `includeHidden` 默认 false，避免把大量隐藏目录带入上下文。
 */
function parseArgs(rawArgs: Record<string, unknown>): ListFilesArgs {
  const rawPath = rawArgs.path;
  const requestedPath = rawPath === undefined ? "." : rawPath;
  if (typeof requestedPath !== "string" || requestedPath.trim() === "") {
    throw new Error("list_files 参数 'path' 必须是非空字符串。");
  }

  const maxDepth = parsePositiveIntInRange(
    rawArgs.maxDepth,
    DEFAULT_MAX_DEPTH,
    0,
    MAX_ALLOWED_DEPTH,
    "maxDepth"
  );
  const limit = parsePositiveIntInRange(rawArgs.limit, DEFAULT_LIMIT, 1, MAX_ALLOWED_LIMIT, "limit");

  const rawIncludeHidden = rawArgs.includeHidden;
  if (rawIncludeHidden !== undefined && typeof rawIncludeHidden !== "boolean") {
    throw new Error("list_files 参数 'includeHidden' 必须是布尔值。");
  }

  return {
    path: requestedPath.trim(),
    maxDepth,
    limit,
    includeHidden: rawIncludeHidden ?? false
  };
}

/**
 * 将用户请求路径解析到项目边界内。
 *
 * 安全意义：
 * - 防止 `../` 路径穿越；
 * - 保证工具只在项目目录内活动。
 */
function resolvePathInsideRoot(rootDir: string, requestedPath: string): string {
  const absoluteRoot = path.resolve(rootDir);
  const absoluteTarget = path.resolve(absoluteRoot, requestedPath);
  const relative = path.relative(absoluteRoot, absoluteTarget);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`拒绝访问：'${requestedPath}' 超出项目根目录范围。`);
  }

  return absoluteTarget;
}

/**
 * 将绝对路径转换为项目内的相对路径（统一为 `/` 风格）。
 */
function toProjectRelativePath(rootDir: string, absolutePath: string): string {
  const relativePath = path.relative(path.resolve(rootDir), absolutePath);
  return relativePath.split(path.sep).join("/");
}

function shouldSkipEntry(name: string, includeHidden: boolean, isDirectory: boolean): boolean {
  if (!includeHidden && name.startsWith(".")) {
    return true;
  }
  if (isDirectory && NOISY_DIRECTORY_NAMES.has(name)) {
    return true;
  }

  return false;
}

function sortDirectoryEntries(a: Dirent, b: Dirent): number {
  if (a.isDirectory() && !b.isDirectory()) {
    return -1;
  }
  if (!a.isDirectory() && b.isDirectory()) {
    return 1;
  }

  return a.name.localeCompare(b.name);
}

export function createListFilesTool(options: ListFilesToolOptions): ToolDefinition {
  return {
    name: "list_files",
    description: "列出项目内目录结构，可按层级返回目录与文件。",
    isReadOnly: true,
    isDestructive: false,
    isConcurrencySafe: true,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "项目内相对目录路径，默认 '.'。"
        },
        maxDepth: {
          type: "number",
          description: `递归深度，默认 ${DEFAULT_MAX_DEPTH}，最大 ${MAX_ALLOWED_DEPTH}。`
        },
        limit: {
          type: "number",
          description: `最多返回条目数，默认 ${DEFAULT_LIMIT}，最大 ${MAX_ALLOWED_LIMIT}。`
        },
        includeHidden: {
          type: "boolean",
          description: "是否包含隐藏文件/目录（默认 false）。"
        }
      },
      additionalProperties: false
    },
    async execute(rawArgs) {
      const args = parseArgs(rawArgs);
      const targetDir = resolvePathInsideRoot(options.rootDir, args.path);
      const stats = await fs.stat(targetDir);

      if (!stats.isDirectory()) {
        throw new Error(`'${args.path}' 不是目录。`);
      }

      const entries: ListedEntry[] = [];
      let truncated = false;

      /**
       * 深度优先遍历目录。
       *
       * 风险控制：
       * - 受 `maxDepth` 与 `limit` 双重限制；
       * - 一旦达到 `limit` 立即停止递归，避免超大目录拖慢响应。
       */
      const walk = async (currentDir: string, currentDepth: number): Promise<void> => {
        if (truncated || currentDepth >= args.maxDepth) {
          return;
        }

        const dirEntries = await fs.readdir(currentDir, {
          withFileTypes: true
        });
        dirEntries.sort(sortDirectoryEntries);

        for (const entry of dirEntries) {
          if (shouldSkipEntry(entry.name, args.includeHidden, entry.isDirectory())) {
            continue;
          }

          const absoluteEntryPath = path.join(currentDir, entry.name);
          entries.push({
            path: toProjectRelativePath(options.rootDir, absoluteEntryPath),
            kind: entry.isDirectory() ? "directory" : "file",
            depth: currentDepth + 1
          });

          if (entries.length >= args.limit) {
            truncated = true;
            return;
          }

          if (entry.isDirectory()) {
            await walk(absoluteEntryPath, currentDepth + 1);
            if (truncated) {
              return;
            }
          }
        }
      };

      await walk(targetDir, 0);

      return JSON.stringify(
        {
          path: args.path,
          resolvedPath: targetDir,
          maxDepth: args.maxDepth,
          limit: args.limit,
          truncated,
          entryCount: entries.length,
          entries
        },
        null,
        2
      );
    }
  };
}
