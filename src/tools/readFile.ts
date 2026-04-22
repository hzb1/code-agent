import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types.js";

/**
 * read_file 工具：
 * - 只负责“安全读取文本文件”；
 * - 不负责业务语义解释（那是模型层工作）；
 * - 通过路径边界与长度限制控制风险。
 */

// 工具初始化参数：根目录边界 + 内容长度上限。
type ReadFileToolOptions = {
  rootDir: string;
  maxChars: number;
};

type ReadFileArgs = {
  path: string;
};

type ReadFileStage = "stat" | "read";

/**
 * 校验并规范化工具入参。
 *
 * 约束：
 * - `path` 必须是非空字符串；
 * - 去掉首尾空白，避免“看似有值、实际无效”的输入。
 */
function parseArgs(args: Record<string, unknown>): ReadFileArgs {
  const rawPath = args.path;
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    throw new Error("read_file 需要名为 'path' 的非空字符串参数。");
  }

  return { path: rawPath.trim() };
}

/**
 * 将目标路径解析到项目根目录下，并做越界检查。
 *
 * 安全意义：
 * - 阻止 `../` 等路径穿越；
 * - 将工具访问面限制在当前项目内，避免读取本机其它敏感文件。
 *
 * 注意：
 * - 这里基于路径解析与相对路径检查；
 * - 对软链接跨目录场景的更强防护可在后续版本补充 `realpath` 校验。
 */
function resolvePathInsideRoot(rootDir: string, requestedPath: string): string {
  const absoluteRoot = path.resolve(rootDir);
  const absoluteFile = path.resolve(absoluteRoot, requestedPath);
  const relative = path.relative(absoluteRoot, absoluteFile);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`拒绝访问：'${requestedPath}' 超出项目根目录范围。`);
  }

  return absoluteFile;
}

/**
 * 将底层文件系统错误翻译为更可操作的中文提示。
 *
 * 为什么要做这层翻译：
 * - Node 原始 errno 对终端用户不友好（例如 ENOENT、EACCES）；
 * - 工具是给模型和用户同时消费的，提示必须直接告诉“下一步怎么做”；
 * - 统一错误文案也便于后续测试断言和回归排查。
 */
function toReadableFileErrorMessage(
  stage: ReadFileStage,
  requestedPath: string,
  absoluteFile: string,
  error: unknown
): string {
  const errno = error as NodeJS.ErrnoException;
  const code = errno.code;
  const action = stage === "stat" ? "检查文件状态" : "读取文件内容";

  if (code === "ENOENT") {
    return `读取失败：文件不存在（${requestedPath}）。请先用 search_files 或 list_files 确认路径。`;
  }

  if (code === "EACCES" || code === "EPERM") {
    return `读取失败：没有权限访问文件（${requestedPath}）。请检查文件权限或改用可访问路径。`;
  }

  if (code === "EISDIR") {
    return `读取失败：目标是目录而不是文件（${requestedPath}）。请改用 read_file 读取具体文件。`;
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  return `读取失败：${action}时发生错误（${requestedPath} -> ${absoluteFile}）。${rawMessage}`;
}

export function createReadFileTool(options: ReadFileToolOptions): ToolDefinition {
  return {
    name: "read_file",
    description: "读取当前项目目录中的 UTF-8 文本文件。",
    /**
     * 工具元信息（当前骨架阶段先完成声明，后续版本再接入权限系统）。
     *
     * - read_file 只读，不修改环境；
     * - 不是破坏性操作；
     * - 读取本身可并发执行，不依赖共享可变状态。
     */
    isReadOnly: true,
    isDestructive: false,
    isConcurrencySafe: true,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "项目内相对路径，例如：package.json"
        }
      },
      required: ["path"],
      additionalProperties: false
    },
    async execute(rawArgs) {
      /**
       * 执行流程：
       * 1. 解析参数；
       * 2. 校验访问边界；
       * 3. 校验目标是常规文件；
       * 4. 读取并按上限截断；
       * 5. 返回结构化 JSON 结果。
       */
      const args = parseArgs(rawArgs);
      const absoluteFile = resolvePathInsideRoot(options.rootDir, args.path);
      let fileStats: Awaited<ReturnType<typeof fs.stat>>;
      try {
        fileStats = await fs.stat(absoluteFile);
      } catch (error) {
        throw new Error(toReadableFileErrorMessage("stat", args.path, absoluteFile, error));
      }

      if (!fileStats.isFile()) {
        throw new Error(`'${args.path}' 不是常规文件。`);
      }

      let content: string;
      try {
        content = await fs.readFile(absoluteFile, "utf8");
      } catch (error) {
        throw new Error(toReadableFileErrorMessage("read", args.path, absoluteFile, error));
      }
      /**
       * 超长文件按上限截断，并显式返回 `truncated` 标记。
       *
       * 这样做的目的：
       * - 控制上下文大小，避免 token 与响应时长失控；
       * - 让上游模型知道“内容不完整”，从而谨慎给出结论。
       */
      const truncated = content.length > options.maxChars;
      const safeContent = truncated ? content.slice(0, options.maxChars) : content;
      const originalCharCount = content.length;
      const returnedCharCount = safeContent.length;

      // 输出统一结构，便于模型在不同场景下稳定解析。
      return JSON.stringify(
        {
          path: args.path,
          resolvedPath: absoluteFile,
          truncated,
          originalCharCount,
          returnedCharCount,
          truncationHint: truncated
            ? `文件内容过长，已截断到前 ${options.maxChars} 个字符。可缩小读取范围或分段读取。`
            : undefined,
          content: safeContent
        },
        null,
        2
      );
    }
  };
}
