import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../core/types.js";

// 读取工具运行参数：根目录边界 + 内容长度上限。
type ReadFileToolOptions = {
  rootDir: string;
  maxChars: number;
};

type ReadFileArgs = {
  path: string;
};

// 校验并规范化工具入参，拒绝空路径。
function parseArgs(args: Record<string, unknown>): ReadFileArgs {
  const rawPath = args.path;
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    throw new Error("read_file expects a non-empty string field named 'path'.");
  }

  return { path: rawPath.trim() };
}

// 强制解析到项目根目录内，防止通过 ../ 等方式越界读取文件。
function resolvePathInsideRoot(rootDir: string, requestedPath: string): string {
  const absoluteRoot = path.resolve(rootDir);
  const absoluteFile = path.resolve(absoluteRoot, requestedPath);
  const relative = path.relative(absoluteRoot, absoluteFile);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Access denied: '${requestedPath}' is outside the project root.`);
  }

  return absoluteFile;
}

export function createReadFileTool(options: ReadFileToolOptions): ToolDefinition {
  return {
    name: "read_file",
    description: "Read a UTF-8 file from the current project directory.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path inside the project, for example: package.json"
        }
      },
      required: ["path"],
      additionalProperties: false
    },
    async execute(rawArgs) {
      const args = parseArgs(rawArgs);
      const absoluteFile = resolvePathInsideRoot(options.rootDir, args.path);
      const fileStats = await fs.stat(absoluteFile);

      if (!fileStats.isFile()) {
        throw new Error(`'${args.path}' is not a regular file.`);
      }

      const content = await fs.readFile(absoluteFile, "utf8");
      // 超长文件按上限截断，并显式返回 truncated 标记给上游模型。
      const truncated = content.length > options.maxChars;
      const safeContent = truncated ? content.slice(0, options.maxChars) : content;

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
