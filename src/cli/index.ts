#!/usr/bin/env node

import "dotenv/config";
import { setDefaultResultOrder } from "node:dns";
import { QueryEngine } from "../app/queryEngine.js";
import { loadConfig } from "../core/config.js";
import { createToolRegistry } from "../tools/registry.js";

/**
 * CLI 入口职责：
 * 1. 读取环境变量；
 * 2. 解析用户输入；
 * 3. 初始化 QueryEngine 并执行查询；
 * 4. 统一错误出口与退出码。
 *
 * 约束：
 * - 只做“启动与编排”，不承载业务逻辑；
 * - 业务策略应放在 app/loop/llm/tools 层。
 */

// 统一的 CLI 用法提示，参数缺失时输出到 stderr。
function printUsage(): void {
  console.error('Usage: code-agent "<question>"');
}

async function main(): Promise<void> {
  /**
   * 某些网络环境下 IPv6 解析可达但链路不稳定，会表现为“请求长时间卡住”。
   * 默认设为 ipv4first，优先走更稳定路径；仍允许通过环境变量覆盖策略。
   */
  setDefaultResultOrder((process.env.DNS_RESULT_ORDER as "ipv4first" | "verbatim" | undefined) ?? "ipv4first");

  // 将命令行余下参数拼接为一个问题字符串，兼容多词输入场景。
  const prompt = process.argv.slice(2).join(" ").trim();
  if (!prompt) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  try {
    /**
     * v0.1.0 后 CLI 只做“配置初始化 + Engine 调度”。
     *
     * 关键边界：
     * - CLI 不直接参与模型循环；
     * - CLI 不直接触达工具执行；
     * - 这样可以保证后续 REPL/多轮模式也复用同一编排层。
     */
    const config = loadConfig();
    const toolRegistry = createToolRegistry({
      rootDir: config.projectRoot,
      maxFileChars: config.maxFileChars
    });
    const engine = new QueryEngine({
      config,
      toolRegistry
    });
    const answer = await engine.run(prompt);
    console.log(answer);
  } catch (error) {
    /**
     * 统一错误出口：
     * - 将未知异常归一为文本；
     * - 打印固定前缀便于日志检索；
     * - 以非 0 退出码向上游脚本明确失败状态。
     */
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[code-agent] ${message}`);
    process.exitCode = 1;
  }
}

// 显式忽略 Promise 返回值，避免顶层未处理 Promise 警告噪音。
void main();
