import { QueryEngine } from "../app/queryEngine.js";
import { loadConfig } from "../core/config.js";
import { createToolRegistry } from "../tools/registry.js";

/**
 * 兼容入口：保留 `runAgent` 以降低重构迁移成本。
 *
 * 说明：
 * - v0.1.0 后，真正的编排与循环能力已经迁移到 QueryEngine + QueryLoop；
 * - 本函数只做“兼容层转发”，避免旧调用方立即失效；
 * - CLI 主入口会直接使用 QueryEngine，不再依赖本文件。
 */
export async function runAgent(userInput: string): Promise<string> {
  const config = loadConfig();
  const registry = createToolRegistry({
    rootDir: config.projectRoot,
    maxFileChars: config.maxFileChars
  });

  const engine = new QueryEngine({
    config,
    toolRegistry: registry
  });

  return engine.run(userInput);
}

