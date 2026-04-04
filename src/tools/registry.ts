import type { ToolDefinition } from "../core/types.js";
import { createReadFileTool } from "./readFile.js";

type RegistryOptions = {
  rootDir: string;
  maxFileChars: number;
};

export function createToolRegistry(options: RegistryOptions): Map<string, ToolDefinition> {
  const readFileTool = createReadFileTool({
    rootDir: options.rootDir,
    maxChars: options.maxFileChars
  });

  return new Map([[readFileTool.name, readFileTool]]);
}

export function listTools(registry: Map<string, ToolDefinition>): ToolDefinition[] {
  return Array.from(registry.values());
}
