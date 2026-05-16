import fs from "node:fs/promises";
import path from "node:path";
import { createTextDiffPreview } from "#src/tools/diff.js";
import type { ToolDefinition } from "#src/tools/types.js";

type WriteFileToolOptions = {
  rootDir: string;
};

type WriteFileArgs = {
  path: string;
  content: string;
  overwrite: boolean;
};

type ExistingFileState = {
  exists: boolean;
  isFile: boolean;
  content: string;
};

function parseArgs(rawArgs: Record<string, unknown>): WriteFileArgs {
  const rawPath = rawArgs.path;
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    throw new Error("write_file 参数 'path' 必须是非空字符串。");
  }

  const rawContent = rawArgs.content;
  if (typeof rawContent !== "string") {
    throw new Error("write_file 参数 'content' 必须是字符串。");
  }

  const rawOverwrite = rawArgs.overwrite;
  if (rawOverwrite !== undefined && typeof rawOverwrite !== "boolean") {
    throw new Error("write_file 参数 'overwrite' 必须是布尔值。");
  }

  return {
    path: rawPath.trim(),
    content: rawContent,
    overwrite: rawOverwrite ?? false
  };
}

function resolvePathInsideRoot(rootDir: string, requestedPath: string): string {
  const absoluteRoot = path.resolve(rootDir);
  const absoluteFile = path.resolve(absoluteRoot, requestedPath);
  const relative = path.relative(absoluteRoot, absoluteFile);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`拒绝写入：'${requestedPath}' 超出项目根目录范围。`);
  }

  return absoluteFile;
}

async function readExistingFileState(absolutePath: string): Promise<ExistingFileState> {
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      return {
        exists: true,
        isFile: false,
        content: ""
      };
    }
    const content = await fs.readFile(absolutePath, "utf8");
    return {
      exists: true,
      isFile: true,
      content
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        exists: false,
        isFile: true,
        content: ""
      };
    }
    throw error;
  }
}

function toNewFilePreviewLines(content: string, maxLines = 16): string[] {
  const lines = content.split(/\r?\n/);
  const preview = lines.slice(0, maxLines).map((line) => `+ ${line}`);
  if (lines.length > maxLines) {
    preview.push(`+ ...(省略 ${lines.length - maxLines} 行)`);
  }
  return preview;
}

export function createWriteFileTool(options: WriteFileToolOptions): ToolDefinition {
  return {
    name: "write_file",
    description: "在项目目录内写入文本文件（默认不覆盖，需显式 overwrite=true）。",
    isReadOnly: false,
    isDestructive: true,
    isConcurrencySafe: false,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "项目内相对文件路径。"
        },
        content: {
          type: "string",
          description: "完整文件内容（UTF-8 文本）。"
        },
        overwrite: {
          type: "boolean",
          description: "若目标已存在，是否允许覆盖。默认 false。"
        }
      },
      required: ["path", "content"],
      additionalProperties: false
    },
    async checkPermissions({ args }) {
      let parsed: WriteFileArgs;
      try {
        parsed = parseArgs(args);
      } catch (error) {
        return {
          behavior: "deny",
          reason: error instanceof Error ? error.message : String(error)
        };
      }

      let absolutePath: string;
      try {
        absolutePath = resolvePathInsideRoot(options.rootDir, parsed.path);
      } catch (error) {
        return {
          behavior: "deny",
          reason: error instanceof Error ? error.message : String(error)
        };
      }

      const existingState = await readExistingFileState(absolutePath);
      if (existingState.exists && !existingState.isFile) {
        return {
          behavior: "deny",
          reason: `拒绝写入：'${parsed.path}' 不是普通文件。`
        };
      }

      if (existingState.exists && !parsed.overwrite) {
        return {
          behavior: "deny",
          reason: `目标文件已存在（${parsed.path}）。如需覆盖，请显式设置 overwrite=true。`
        };
      }

      if (!existingState.exists) {
        return {
          behavior: "ask",
          reason: `准备新建文件：${parsed.path}`,
          previewTitle: "新文件预览",
          previewLines: toNewFilePreviewLines(parsed.content)
        };
      }

      const diffPreview = createTextDiffPreview({
        beforeContent: existingState.content,
        afterContent: parsed.content
      });
      return {
        behavior: "ask",
        reason: `准备覆盖文件：${parsed.path}`,
        previewTitle: diffPreview.summary,
        previewLines: diffPreview.lines
      };
    },
    async execute(rawArgs) {
      const parsed = parseArgs(rawArgs);
      const absolutePath = resolvePathInsideRoot(options.rootDir, parsed.path);
      const existingState = await readExistingFileState(absolutePath);

      if (existingState.exists && !existingState.isFile) {
        throw new Error(`写入失败：'${parsed.path}' 不是普通文件。`);
      }

      if (existingState.exists && !parsed.overwrite) {
        throw new Error(`写入失败：目标文件已存在（${parsed.path}），请设置 overwrite=true。`);
      }

      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, parsed.content, "utf8");

      const diffPreview = createTextDiffPreview({
        beforeContent: existingState.content,
        afterContent: parsed.content
      });

      return JSON.stringify(
        {
          path: parsed.path,
          resolvedPath: absolutePath,
          created: !existingState.exists,
          overwritten: existingState.exists,
          beforeCharCount: existingState.content.length,
          afterCharCount: parsed.content.length,
          changed: diffPreview.changed,
          diffSummary: diffPreview.summary
        },
        null,
        2
      );
    }
  };
}
