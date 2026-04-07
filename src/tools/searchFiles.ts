import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types.js";

/**
 * search_files 工具：
 * - 在“文件名/路径”层做检索（不做文件内容 grep）；
 * - 返回候选文件列表，供下一步 read_file 精读；
 * - 保持只读、安全、可控开销。
 */

type SearchFilesToolOptions = {
  rootDir: string;
};

type SearchFilesArgs = {
  query: string;
  path: string;
  maxDepth: number;
  limit: number;
  includeHidden: boolean;
};

type SearchCandidate = {
  path: string;
  score: number;
};

const DEFAULT_MAX_DEPTH = 8;
const MAX_ALLOWED_DEPTH = 12;
const DEFAULT_LIMIT = 30;
const MAX_ALLOWED_LIMIT = 200;
const MAX_SCANNED_FILES = 20_000;

const NOISY_DIRECTORY_NAMES = new Set([
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
    throw new Error(`search_files 参数 '${fieldName}' 必须是整数。`);
  }
  if (value < min || value > max) {
    throw new Error(`search_files 参数 '${fieldName}' 必须在 ${min} 到 ${max} 之间。`);
  }

  return value;
}

/**
 * 解析 search_files 入参。
 *
 * 参数约束：
 * - `query` 必填；
 * - `path/maxDepth/limit/includeHidden` 都有默认值；
 * - 默认只扫描可见目录，减少噪音与开销。
 */
function parseArgs(rawArgs: Record<string, unknown>): SearchFilesArgs {
  const rawQuery = rawArgs.query;
  if (typeof rawQuery !== "string" || rawQuery.trim() === "") {
    throw new Error("search_files 参数 'query' 必须是非空字符串。");
  }

  const rawPath = rawArgs.path;
  const requestedPath = rawPath === undefined ? "." : rawPath;
  if (typeof requestedPath !== "string" || requestedPath.trim() === "") {
    throw new Error("search_files 参数 'path' 必须是非空字符串。");
  }

  const maxDepth = parsePositiveIntInRange(
    rawArgs.maxDepth,
    DEFAULT_MAX_DEPTH,
    1,
    MAX_ALLOWED_DEPTH,
    "maxDepth"
  );
  const limit = parsePositiveIntInRange(rawArgs.limit, DEFAULT_LIMIT, 1, MAX_ALLOWED_LIMIT, "limit");

  const rawIncludeHidden = rawArgs.includeHidden;
  if (rawIncludeHidden !== undefined && typeof rawIncludeHidden !== "boolean") {
    throw new Error("search_files 参数 'includeHidden' 必须是布尔值。");
  }

  return {
    query: rawQuery.trim(),
    path: requestedPath.trim(),
    maxDepth,
    limit,
    includeHidden: rawIncludeHidden ?? false
  };
}

function resolvePathInsideRoot(rootDir: string, requestedPath: string): string {
  const absoluteRoot = path.resolve(rootDir);
  const absoluteTarget = path.resolve(absoluteRoot, requestedPath);
  const relative = path.relative(absoluteRoot, absoluteTarget);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`拒绝访问：'${requestedPath}' 超出项目根目录范围。`);
  }

  return absoluteTarget;
}

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

/**
 * 路径级评分函数。
 *
 * 评分策略：
 * - 文件名精确匹配 > 前缀匹配 > 包含匹配；
 * - 路径整体匹配作为附加分；
 * - 分数越高表示越“像用户要找的目标文件”。
 */
function scorePath(relativePath: string, normalizedQuery: string): number {
  const normalizedPath = relativePath.toLowerCase();
  const normalizedBaseName = path.basename(relativePath).toLowerCase();
  let score = 0;

  if (normalizedBaseName === normalizedQuery) {
    score += 120;
  } else if (normalizedBaseName.startsWith(normalizedQuery)) {
    score += 90;
  } else if (normalizedBaseName.includes(normalizedQuery)) {
    score += 70;
  }

  if (normalizedPath === normalizedQuery) {
    score += 80;
  } else if (normalizedPath.startsWith(normalizedQuery)) {
    score += 40;
  } else if (normalizedPath.includes(normalizedQuery)) {
    score += 30;
  }

  return score;
}

function compareCandidates(a: SearchCandidate, b: SearchCandidate): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (a.path.length !== b.path.length) {
    return a.path.length - b.path.length;
  }

  return a.path.localeCompare(b.path);
}

export function createSearchFilesTool(options: SearchFilesToolOptions): ToolDefinition {
  return {
    name: "search_files",
    description: "按关键词检索项目内文件路径（文件名/相对路径匹配）。",
    isReadOnly: true,
    isDestructive: false,
    isConcurrencySafe: true,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "关键词，例如 queryLoop 或 config。"
        },
        path: {
          type: "string",
          description: "检索起始目录（项目内相对路径），默认 '.'."
        },
        maxDepth: {
          type: "number",
          description: `递归深度，默认 ${DEFAULT_MAX_DEPTH}，最大 ${MAX_ALLOWED_DEPTH}。`
        },
        limit: {
          type: "number",
          description: `最多返回候选数量，默认 ${DEFAULT_LIMIT}，最大 ${MAX_ALLOWED_LIMIT}。`
        },
        includeHidden: {
          type: "boolean",
          description: "是否包含隐藏文件/目录（默认 false）。"
        }
      },
      required: ["query"],
      additionalProperties: false
    },
    async execute(rawArgs) {
      const args = parseArgs(rawArgs);
      const targetDir = resolvePathInsideRoot(options.rootDir, args.path);
      const stats = await fs.stat(targetDir);

      if (!stats.isDirectory()) {
        throw new Error(`'${args.path}' 不是目录。`);
      }

      const normalizedQuery = args.query.toLowerCase();
      const candidates: SearchCandidate[] = [];
      let scannedFiles = 0;
      let scanTruncated = false;

      /**
       * 深度优先扫描文件路径。
       *
       * 风险控制：
       * - 深度受 `maxDepth` 限制；
       * - 总扫描文件数受 `MAX_SCANNED_FILES` 限制；
       * - 达到扫描上限后停止，防止极端大仓库拖垮单次请求。
       */
      const walk = async (currentDir: string, currentDepth: number): Promise<void> => {
        if (scanTruncated || currentDepth > args.maxDepth) {
          return;
        }

        const dirEntries = await fs.readdir(currentDir, {
          withFileTypes: true
        });

        for (const entry of dirEntries) {
          if (shouldSkipEntry(entry.name, args.includeHidden, entry.isDirectory())) {
            continue;
          }

          const absoluteEntryPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            await walk(absoluteEntryPath, currentDepth + 1);
            if (scanTruncated) {
              return;
            }
            continue;
          }

          if (!entry.isFile()) {
            continue;
          }

          scannedFiles += 1;
          if (scannedFiles > MAX_SCANNED_FILES) {
            scanTruncated = true;
            return;
          }

          const relativePath = toProjectRelativePath(options.rootDir, absoluteEntryPath);
          const score = scorePath(relativePath, normalizedQuery);
          if (score > 0) {
            candidates.push({
              path: relativePath,
              score
            });
          }
        }
      };

      await walk(targetDir, 1);

      candidates.sort(compareCandidates);
      const truncated = scanTruncated || candidates.length > args.limit;
      const results = candidates.slice(0, args.limit);

      return JSON.stringify(
        {
          query: args.query,
          path: args.path,
          resolvedPath: targetDir,
          maxDepth: args.maxDepth,
          limit: args.limit,
          scannedFiles,
          truncated,
          resultCount: results.length,
          results
        },
        null,
        2
      );
    }
  };
}
