import path from "node:path";
import { ConfigError } from "#src/core/errors.js";

/**
 * 支持的 Provider 白名单。
 *
 * 为什么要导出常量而不是散落字符串：
 * - 让 CLI 启动、doctor 诊断、测试都复用同一数据源；
 * - 避免“启动支持了新 provider，但 doctor 还没更新”的规则漂移问题；
 * - 便于后续扩展 provider 时只改一处。
 */
export const SUPPORTED_LLM_PROVIDERS = ["deepseek", "zhipu", "qwen", "bytedance"] as const;

export type LlmProvider = (typeof SUPPORTED_LLM_PROVIDERS)[number];

/**
 * 全局运行配置：由环境变量解析后得到，供 agent/llm/tool 统一使用。
 *
 * 设计目标：
 * - 统一配置入口，避免各模块直接读 process.env 导致行为不一致；
 * - 通过类型收敛，把“字符串配置”转换成“可直接消费的强类型配置”；
 * - 将默认值策略集中在这里，降低调用方复杂度。
 */
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
    model: "qwen3.6-plus"
  },
  bytedance: {
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3"
  }
};

const DEFAULT_PROVIDER: LlmProvider = "qwen";
/**
 * 默认循环上限（单次查询）。
 *
 * 设计取舍：
 * - 5 轮在“解释单文件”场景足够，但在“分析整个项目”这类跨文件任务里偏紧，
 *   容易在模型还在拉取关键信息时被提前终止；
 * - 将默认值提升到 12，仍然保持明确上限，继续满足“禁止无限循环”的安全约束。
 */
const DEFAULT_MAX_AGENT_LOOPS = 12;
const DEFAULT_MAX_FILE_CHARS = 10_000;
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * 判断字符串是否属于受支持 provider。
 *
 * 这层小函数的价值在于：
 * - 把 “字符串 -> LlmProvider” 的收敛逻辑集中；
 * - 供 loadConfig 与 doctor 共用，确保行为一致。
 */
export function isLlmProvider(value: string): value is LlmProvider {
  return SUPPORTED_LLM_PROVIDERS.some((provider) => provider === value);
}

/**
 * 获取 provider 默认配置（baseUrl / model）。
 *
 * 返回只读拷贝，避免调用方误改全局默认值对象。
 */
export function getProviderDefaultConfig(provider: LlmProvider): { baseUrl: string; model?: string } {
  const defaults = PROVIDER_DEFAULTS[provider];
  return {
    baseUrl: defaults.baseUrl,
    model: defaults.model
  };
}

/**
 * 解析正整数配置项。
 *
 * 处理策略：
 * - 缺失值 -> 回退默认值；
 * - 非数字或小于等于 0 -> 回退默认值；
 * - 合法正整数 -> 直接使用。
 *
 * 为什么回退而不是抛错：
 * - 这类配置通常是“性能/资源上限”而不是“启动必要条件”；
 * - 回退默认值可以提高容错性，减少无意义的启动失败。
 */
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

/**
 * 统一 provider 白名单校验。
 *
 * 风险点：
 * - 若不在入口校验，拼写错误会在网络层才暴露，定位成本高；
 * - 统一在此处失败可以给出清晰错误，提升排障效率。
 */
function parseProvider(raw: string | undefined): LlmProvider {
  const provider = raw?.trim().toLowerCase() ?? DEFAULT_PROVIDER;
  if (isLlmProvider(provider)) {
    return provider;
  }

  throw new ConfigError(
    `不支持的 LLM_PROVIDER '${raw}'。可选值：${SUPPORTED_LLM_PROVIDERS.join("、")}。`
  );
}

/**
 * 将空字符串归一为 undefined，便于后续用 `??` 统一处理默认值回退。
 *
 * 这样可以避免出现：
 * - 用户写了 `LLM_MODEL=`（空值）却覆盖默认模型；
 * - 逻辑上“有配置但无内容”的隐性错误。
 */
function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * 按 provider 选择 API Key：优先通用变量，再回退 provider 专属变量。
 *
 * 设计理由：
 * - 通用变量便于快速切换 provider；
 * - 专属变量适合多 provider 并存场景；
 * - 缺失时给出 provider 对应提示，降低配置门槛。
 */
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
      ? "请设置 LLM_API_KEY 或 DEEPSEEK_API_KEY。"
      : provider === "zhipu"
        ? "请设置 LLM_API_KEY、ZHIPU_API_KEY 或 ZAI_API_KEY。"
        : provider === "qwen"
          ? "请设置 LLM_API_KEY 或 DASHSCOPE_API_KEY。"
          : "请设置 LLM_API_KEY 或 ARK_API_KEY。";

  throw new ConfigError(`provider='${provider}' 缺少 API Key。${hint}`);
}

/**
 * 统一去除 base URL 结尾斜杠。
 *
 * 目的：
 * - 避免 endpoint 拼接时出现 `//chat/completions`；
 * - 减少不同 provider URL 风格差异带来的细节错误。
 */
function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function loadConfig(): AppConfig {
  /**
   * 配置装配顺序说明：
   * 1. 先解析 provider（决定后续默认值与 key 来源）；
   * 2. 再解析 baseUrl/model（支持显式覆盖）；
   * 3. 最后解析通用运行参数（loop/file/timeout）。
   *
   * 这样设计可以确保 provider 相关默认值始终可预测。
   */
  const provider = parseProvider(process.env.LLM_PROVIDER);
  const providerDefault = getProviderDefaultConfig(provider);
  const baseUrl = normalizeBaseUrl(trimOrUndefined(process.env.LLM_BASE_URL) ?? providerDefault.baseUrl);
  const model = trimOrUndefined(process.env.LLM_MODEL) ?? providerDefault.model;

  if (!model) {
    throw new ConfigError(
      `provider='${provider}' 缺少模型配置。请设置 LLM_MODEL（ByteDance 通常填 endpoint/model id）。`
    );
  }

  return {
    /**
     * 将当前工作目录作为工具访问边界根目录。
     *
     * 风险提示：
     * - 运行命令所在目录会直接影响文件访问范围；
     * - 因此应在项目根目录执行 CLI，避免边界误判。
     */
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
