import type { ToolDefinition } from "../core/types.js";
import { createReadFileTool } from "./readFile.js";

// 注册中心初始化参数：用于向具体工具注入运行边界。
type RegistryOptions = {
  rootDir: string;
  maxFileChars: number;
};

export function createToolRegistry(options: RegistryOptions): Map<string, ToolDefinition> {
  // 当前版本仅注册 read_file，后续可在此扩展更多工具。
  const readFileTool = createReadFileTool({
    rootDir: options.rootDir,
    maxChars: options.maxFileChars
  });

  return new Map([[readFileTool.name, readFileTool]]);
}

// 统一导出工具列表，便于转换为 LLM 的 tools 协议。
export function listTools(registry: Map<string, ToolDefinition>): ToolDefinition[] {
  return Array.from(registry.values());
}
