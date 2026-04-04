import type { ToolDefinition } from "../core/types.js";
import { createReadFileTool } from "./readFile.js";

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
   * 当前版本仅注册 `read_file`。
   *
   * 这样做的原因：
   * - 保持 v0 阶段功能边界清晰；
   * - 降低权限面，优先确保读取能力稳定可靠；
   * - 为后续渐进式扩展工具保留单一入口。
   */
  const readFileTool = createReadFileTool({
    rootDir: options.rootDir,
    maxChars: options.maxFileChars
  });

  return new Map([[readFileTool.name, readFileTool]]);
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
