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

export function createReadFileTool(options: ReadFileToolOptions): ToolDefinition {
  return {
    name: "read_file",
    description: "读取当前项目目录中的 UTF-8 文本文件。",
    /**
     * 工具元信息（v0.1.0 先完成声明，后续版本再接入权限系统）。
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
      const fileStats = await fs.stat(absoluteFile);

      if (!fileStats.isFile()) {
        throw new Error(`'${args.path}' 不是常规文件。`);
      }

      const content = await fs.readFile(absoluteFile, "utf8");
      /**
       * 超长文件按上限截断，并显式返回 `truncated` 标记。
       *
       * 这样做的目的：
       * - 控制上下文大小，避免 token 与响应时长失控；
       * - 让上游模型知道“内容不完整”，从而谨慎给出结论。
       */
      const truncated = content.length > options.maxChars;
      const safeContent = truncated ? content.slice(0, options.maxChars) : content;

      // 输出统一结构，便于模型在不同场景下稳定解析。
      return JSON.stringify(
        {
          path: args.path,
          resolvedPath: absoluteFile,
          truncated,
          content: safeContent
        },
        null,
        2
      );
    }
  };
}
