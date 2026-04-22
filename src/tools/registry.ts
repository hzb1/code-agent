import { createListFilesTool } from "#src/tools/listFiles.js";
import { createReadFileTool } from "#src/tools/readFile.js";
import { createSearchFilesTool } from "#src/tools/searchFiles.js";
import type { ToolDefinition } from "#src/tools/types.js";

/**
 * 工具注册中心：
 * - 统一管理“当前可用工具集合”；
 * - 向工具注入运行时边界（如 rootDir、maxFileChars）；
 * - 为 agent 层提供统一工具列表。
 */

// 注册中心初始化参数：用于向具体工具注入运行边界。
type RegistryOptions = {
  rootDir: string;
  maxFileChars: number;
};

export function createToolRegistry(options: RegistryOptions): Map<string, ToolDefinition> {
  /**
   * 当前版本注册只读检索三件套：
   * - `list_files`：先看目录骨架；
   * - `search_files`：按关键词定位候选文件；
   * - `read_file`：读取具体文件内容。
   *
   * 这样设计的原因：
   * - 让模型具备“先找再读”的最小工作流，减少路径猜测；
   * - 仍然保持全链路只读，符合当前版本安全边界；
   * - 工具都走同一 registry，后续加权限/调度时改动点集中。
   */
  const listFilesTool = createListFilesTool({
    rootDir: options.rootDir
  });
  const searchFilesTool = createSearchFilesTool({
    rootDir: options.rootDir
  });
  const readFileTool = createReadFileTool({
    rootDir: options.rootDir,
    maxChars: options.maxFileChars
  });

  return new Map([
    [listFilesTool.name, listFilesTool],
    [searchFilesTool.name, searchFilesTool],
    [readFileTool.name, readFileTool]
  ]);
}

/**
 * 统一导出工具列表。
 *
 * 为什么不是直接暴露 Map：
 * - 上游通常只需要“可枚举列表”来转换模型协议；
 * - 隐藏底层容器选择，减少调用方耦合。
 */
export function listTools(registry: Map<string, ToolDefinition>): ToolDefinition[] {
  return Array.from(registry.values());
}
