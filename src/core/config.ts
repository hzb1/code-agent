import path from "node:path";

export type LlmProvider = "deepseek" | "zhipu" | "qwen" | "bytedance";

// 全局运行配置：由环境变量解析后得到，供 agent/llm/tool 统一使用。
export type AppConfig = {
  projectRoot: string;
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxAgentLoops: number;
  maxFileChars: number;
  timeoutMs: number;
};

const PROVIDER_DEFAULTS: Record<LlmProvider, { baseUrl: string; model?: string }> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat"
  },
  zhipu: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.7-flash"
  },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3-coder-plus"
  },
  bytedance: {
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3"
  }
};

const DEFAULT_PROVIDER: LlmProvider = "qwen";
const DEFAULT_MAX_AGENT_LOOPS = 5;
const DEFAULT_MAX_FILE_CHARS = 10_000;
const DEFAULT_TIMEOUT_MS = 120_000;

// 解析正整数配置项，非法值自动回退到默认值，避免因配置错误导致崩溃。
function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

// 统一 provider 白名单校验，防止拼写错误进入下游网络调用阶段才报错。
function parseProvider(raw: string | undefined): LlmProvider {
  const provider = raw?.trim().toLowerCase() ?? DEFAULT_PROVIDER;
  if (provider === "deepseek" || provider === "zhipu" || provider === "qwen" || provider === "bytedance") {
    return provider;
  }

  throw new Error(
    `Unsupported LLM_PROVIDER '${raw}'. Use one of: deepseek, zhipu, qwen, bytedance.`
  );
}

// 将空字符串归一为 undefined，便于后续使用 ?? 回退默认值。
function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

// 按 provider 选择 API Key，优先通用变量，再回退 provider 专属变量。
function resolveApiKey(provider: LlmProvider): string {
  const generic = trimOrUndefined(process.env.LLM_API_KEY);
  if (generic) {
    return generic;
  }

  const providerSpecific =
    provider === "deepseek"
      ? trimOrUndefined(process.env.DEEPSEEK_API_KEY)
      : provider === "zhipu"
        ? trimOrUndefined(process.env.ZHIPU_API_KEY) ?? trimOrUndefined(process.env.ZAI_API_KEY)
        : provider === "qwen"
          ? trimOrUndefined(process.env.DASHSCOPE_API_KEY)
          : trimOrUndefined(process.env.ARK_API_KEY);

  if (providerSpecific) {
    return providerSpecific;
  }

  const hint =
    provider === "deepseek"
      ? "Set LLM_API_KEY or DEEPSEEK_API_KEY."
      : provider === "zhipu"
        ? "Set LLM_API_KEY, ZHIPU_API_KEY, or ZAI_API_KEY."
        : provider === "qwen"
          ? "Set LLM_API_KEY or DASHSCOPE_API_KEY."
          : "Set LLM_API_KEY or ARK_API_KEY.";

  throw new Error(`Missing API key for provider '${provider}'. ${hint}`);
}

// 统一去除结尾斜杠，避免 URL 拼接出现双斜杠。
function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function loadConfig(): AppConfig {
  const provider = parseProvider(process.env.LLM_PROVIDER);
  const providerDefault = PROVIDER_DEFAULTS[provider];
  const baseUrl = normalizeBaseUrl(trimOrUndefined(process.env.LLM_BASE_URL) ?? providerDefault.baseUrl);
  const model = trimOrUndefined(process.env.LLM_MODEL) ?? providerDefault.model;

  if (!model) {
    throw new Error(
      `Missing model for provider '${provider}'. Please set LLM_MODEL (for ByteDance usually use your endpoint/model id).`
    );
  }

  return {
    // projectRoot 固定为当前进程工作目录，作为工具访问边界根目录。
    projectRoot: path.resolve(process.cwd()),
    provider,
    apiKey: resolveApiKey(provider),
    baseUrl,
    model,
    maxAgentLoops: parsePositiveInt(process.env.MAX_AGENT_LOOPS, DEFAULT_MAX_AGENT_LOOPS),
    maxFileChars: parsePositiveInt(process.env.MAX_FILE_CHARS, DEFAULT_MAX_FILE_CHARS),
    timeoutMs: parsePositiveInt(process.env.LLM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
  };
}
