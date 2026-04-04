#!/usr/bin/env node

import "dotenv/config";
import { setDefaultResultOrder } from "node:dns";
import { runAgent } from "../agent/runAgent.js";

// 统一的 CLI 用法提示，参数缺失时输出到 stderr。
function printUsage(): void {
  console.error('Usage: code-agent "<question>"');
}

async function main(): Promise<void> {
  // In some networks, IPv6 routing may stall while IPv4 works.
  // Force IPv4-first resolution for more stable CLI requests.
  // 支持通过环境变量覆盖 DNS 解析策略，便于在特殊网络下排障。
  setDefaultResultOrder((process.env.DNS_RESULT_ORDER as "ipv4first" | "verbatim" | undefined) ?? "ipv4first");

  // 将命令行余下参数拼接成用户问题，兼容多词输入。
  const prompt = process.argv.slice(2).join(" ").trim();
  if (!prompt) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  try {
    // 只负责调度 Agent 并打印最终答案，不在 CLI 层做业务处理。
    const answer = await runAgent(prompt);
    console.log(answer);
  } catch (error) {
    // 将任意异常归一为可读文本，保证 CLI 始终给出明确失败原因。
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[code-agent] ${message}`);
    process.exitCode = 1;
  }
}

// 使用 void 显式忽略 Promise 返回值，避免未处理 Promise 警告。
void main();
