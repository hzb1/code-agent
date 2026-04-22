import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getProviderDefaultConfig,
  isLlmProvider,
  SUPPORTED_LLM_PROVIDERS,
  type LlmProvider
} from "#src/core/config.js";

type DoctorCheckStatus = "ok" | "warn" | "error";

type DoctorCheck = {
  status: DoctorCheckStatus;
  title: string;
  detail: string;
  suggestion?: string;
};

type DoctorSummary = {
  checks: ReadonlyArray<DoctorCheck>;
  errorCount: number;
  warningCount: number;
};

/**
 * 去除空白并把空字符串统一为 undefined。
 *
 * 这样做可以让 doctor 与 loadConfig 在“空值是否等价于未配置”这个规则上保持一致，
 * 避免出现同一份 .env 在两个入口下被解释出不同结果的问题。
 */
function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * 统一输出 doctor 检查项。
 *
 * 输出策略：
 * - 全部打印到 stderr，避免污染 stdout（stdout 保留给模型最终答案）；
 * - 每一项都包含状态、检查名、结果细节，方便复制到 issue 或群里排障。
 */
function printCheck(check: DoctorCheck): void {
  const label = check.status === "ok" ? "通过" : check.status === "warn" ? "警告" : "错误";
  console.error(`[ca][doctor] [${label}] ${check.title}：${check.detail}`);
  if (check.suggestion) {
    console.error(`[ca][doctor] 建议：${check.suggestion}`);
  }
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function getProviderApiKeyRequirement(provider: LlmProvider): {
  keyNames: ReadonlyArray<string>;
  hint: string;
} {
  if (provider === "deepseek") {
    return {
      keyNames: ["LLM_API_KEY", "DEEPSEEK_API_KEY"],
      hint: "请设置 LLM_API_KEY 或 DEEPSEEK_API_KEY。"
    };
  }
  if (provider === "zhipu") {
    return {
      keyNames: ["LLM_API_KEY", "ZHIPU_API_KEY", "ZAI_API_KEY"],
      hint: "请设置 LLM_API_KEY、ZHIPU_API_KEY 或 ZAI_API_KEY。"
    };
  }
  if (provider === "qwen") {
    return {
      keyNames: ["LLM_API_KEY", "DASHSCOPE_API_KEY"],
      hint: "请设置 LLM_API_KEY 或 DASHSCOPE_API_KEY。"
    };
  }

  return {
    keyNames: ["LLM_API_KEY", "ARK_API_KEY"],
    hint: "请设置 LLM_API_KEY 或 ARK_API_KEY。"
  };
}

function collectProviderCheck(env: NodeJS.ProcessEnv, checks: DoctorCheck[]): LlmProvider | undefined {
  const raw = trimOrUndefined(env.LLM_PROVIDER);
  if (!raw) {
    checks.push({
      status: "warn",
      title: "LLM_PROVIDER",
      detail: "未设置，将使用默认 provider：qwen。",
      suggestion: "建议显式设置 LLM_PROVIDER，避免不同机器上默认值认知不一致。"
    });
    return "qwen";
  }

  const normalized = raw.toLowerCase();
  if (!isLlmProvider(normalized)) {
    checks.push({
      status: "error",
      title: "LLM_PROVIDER",
      detail: `不支持的 provider：${raw}。`,
      suggestion: `可选值：${SUPPORTED_LLM_PROVIDERS.join("、")}。`
    });
    return undefined;
  }

  checks.push({
    status: "ok",
    title: "LLM_PROVIDER",
    detail: `当前 provider：${normalized}。`
  });
  return normalized;
}

function collectApiKeyCheck(provider: LlmProvider | undefined, env: NodeJS.ProcessEnv, checks: DoctorCheck[]): void {
  if (!provider) {
    checks.push({
      status: "warn",
      title: "API Key",
      detail: "provider 非法，无法判断专属 API Key 变量。",
      suggestion: "先修复 LLM_PROVIDER，再根据 provider 配置 API Key。"
    });
    return;
  }

  const requirement = getProviderApiKeyRequirement(provider);
  const hasKey = requirement.keyNames.some((name) => !!trimOrUndefined(env[name]));
  if (hasKey) {
    checks.push({
      status: "ok",
      title: "API Key",
      detail: `已检测到 ${provider} 可用 API Key。`
    });
    return;
  }

  checks.push({
    status: "error",
    title: "API Key",
    detail: `provider='${provider}' 缺少 API Key。`,
    suggestion: requirement.hint
  });
}

function collectBaseUrlCheck(provider: LlmProvider | undefined, env: NodeJS.ProcessEnv, checks: DoctorCheck[]): void {
  const rawBaseUrl = trimOrUndefined(env.LLM_BASE_URL);
  if (!rawBaseUrl) {
    if (!provider) {
      checks.push({
        status: "warn",
        title: "LLM_BASE_URL",
        detail: "未设置，且当前 provider 非法，无法确定默认值。",
        suggestion: "先修复 LLM_PROVIDER，再根据 provider 设置或使用默认 base URL。"
      });
      return;
    }

    const defaults = getProviderDefaultConfig(provider);
    checks.push({
      status: "ok",
      title: "LLM_BASE_URL",
      detail: `未设置，使用默认值：${defaults.baseUrl}。`
    });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    checks.push({
      status: "error",
      title: "LLM_BASE_URL",
      detail: `URL 格式非法：${rawBaseUrl}。`,
      suggestion: "请设置形如 https://example.com/v1 的完整地址。"
    });
    return;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    checks.push({
      status: "error",
      title: "LLM_BASE_URL",
      detail: `协议不支持：${parsed.protocol}`,
      suggestion: "仅支持 http 或 https。"
    });
    return;
  }

  checks.push({
    status: "ok",
    title: "LLM_BASE_URL",
    detail: `已设置：${normalizeBaseUrl(rawBaseUrl)}。`
  });
}

function collectModelCheck(provider: LlmProvider | undefined, env: NodeJS.ProcessEnv, checks: DoctorCheck[]): void {
  const rawModel = trimOrUndefined(env.LLM_MODEL);
  if (rawModel) {
    checks.push({
      status: "ok",
      title: "LLM_MODEL",
      detail: `已设置：${rawModel}。`
    });
    return;
  }

  if (!provider) {
    checks.push({
      status: "warn",
      title: "LLM_MODEL",
      detail: "未设置，且 provider 非法，无法推导默认模型。",
      suggestion: "先修复 LLM_PROVIDER，再设置 LLM_MODEL。"
    });
    return;
  }

  const defaults = getProviderDefaultConfig(provider);
  if (defaults.model) {
    checks.push({
      status: "warn",
      title: "LLM_MODEL",
      detail: `未设置，将使用默认模型：${defaults.model}。`,
      suggestion: "建议显式设置 LLM_MODEL，避免 provider 默认值升级导致行为变化。"
    });
    return;
  }

  checks.push({
    status: "error",
    title: "LLM_MODEL",
    detail: `provider='${provider}' 无默认模型。`,
    suggestion: "请设置 LLM_MODEL（ByteDance 通常填 endpoint/model id）。"
  });
}

async function collectCwdCheck(projectRoot: string, checks: DoctorCheck[]): Promise<void> {
  try {
    const stat = await fs.stat(projectRoot);
    if (!stat.isDirectory()) {
      checks.push({
        status: "error",
        title: "工作目录",
        detail: `当前路径不是目录：${projectRoot}。`,
        suggestion: "请在项目根目录执行 ca。"
      });
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      status: "error",
      title: "工作目录",
      detail: `无法访问当前目录：${projectRoot}。${message}`,
      suggestion: "请确认目录存在且当前用户有读取权限。"
    });
    return;
  }

  checks.push({
    status: "ok",
    title: "工作目录",
    detail: `可访问：${projectRoot}。`
  });
}

function printCommonNetworkTips(): void {
  console.error("[ca][doctor] 常见网络问题建议：");
  console.error("[ca][doctor] - 401：通常是 API Key 错误或过期，优先检查 LLM_API_KEY。");
  console.error("[ca][doctor] - 403：通常是模型权限/额度不足（含免费额度耗尽），去 provider 控制台确认权限与配额。");
  console.error("[ca][doctor] - 404/空响应：优先检查 LLM_BASE_URL 与 LLM_MODEL 是否匹配当前 provider。");
  console.error("[ca][doctor] - 429 限流：降低并发、延长重试间隔，必要时切更高配额 key。");
  console.error("[ca][doctor] - DNS/连接失败：检查网络、代理和企业网策略，确认目标域名可访问。");
  console.error("[ca][doctor] - 非 JSON 响应：多见于网关返回 HTML 错页，优先检查 base URL 是否写成控制台页面地址。");
  console.error("[ca][doctor] - 超时：先检查网络质量，再适当增大 LLM_TIMEOUT_MS（默认 120000ms）。");
}

function summarizeChecks(checks: ReadonlyArray<DoctorCheck>): DoctorSummary {
  const errorCount = checks.filter((check) => check.status === "error").length;
  const warningCount = checks.filter((check) => check.status === "warn").length;

  return {
    checks,
    errorCount,
    warningCount
  };
}

/**
 * 运行基础 doctor 诊断。
 *
 * v0.2.0 设计边界：
 * - 仅做静态配置检查，不做真实联网探测；
 * - 输出可操作建议，帮助用户先把“必填配置”校正到可运行状态；
 * - 返回退出码（有 error -> 1，无 error -> 0），便于脚本化集成。
 */
export async function runDoctor(projectRoot: string): Promise<number> {
  const checks: DoctorCheck[] = [];
  const env = process.env;
  const provider = collectProviderCheck(env, checks);

  await collectCwdCheck(path.resolve(projectRoot), checks);
  collectApiKeyCheck(provider, env, checks);
  collectBaseUrlCheck(provider, env, checks);
  collectModelCheck(provider, env, checks);

  const summary = summarizeChecks(checks);

  console.error("[ca][doctor] 开始诊断...");
  for (const check of summary.checks) {
    printCheck(check);
  }
  printCommonNetworkTips();

  if (summary.errorCount > 0) {
    console.error(
      `[ca][doctor] 诊断结果：未通过（错误 ${summary.errorCount} 项，警告 ${summary.warningCount} 项）。`
    );
    return 1;
  }

  if (summary.warningCount > 0) {
    console.error(`[ca][doctor] 诊断结果：通过（警告 ${summary.warningCount} 项）。`);
    return 0;
  }

  console.error("[ca][doctor] 诊断结果：通过（无警告）。");
  return 0;
}
