#!/usr/bin/env node

import "dotenv/config";
import { setDefaultResultOrder } from "node:dns";
import { runAgent } from "../agent/runAgent.js";

function printUsage(): void {
  console.error('Usage: code-agent "<question>"');
}

async function main(): Promise<void> {
  // In some networks, IPv6 routing may stall while IPv4 works.
  // Force IPv4-first resolution for more stable CLI requests.
  setDefaultResultOrder((process.env.DNS_RESULT_ORDER as "ipv4first" | "verbatim" | undefined) ?? "ipv4first");

  const prompt = process.argv.slice(2).join(" ").trim();
  if (!prompt) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  try {
    const answer = await runAgent(prompt);
    console.log(answer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[code-agent] ${message}`);
    process.exitCode = 1;
  }
}

void main();
