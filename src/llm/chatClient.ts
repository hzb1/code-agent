import type { AppConfig } from "../core/config.js";
import type { LlmChatCompletionResponse, LlmCreateChatCompletionPayload } from "./types.js";

/**
 * 本文件负责：
 * 1. 组装并发送 OpenAI-compatible chat/completions 请求；
 * 2. 统一处理超时、重试、限流与错误包装；
 * 3. 向上层暴露稳定且可诊断的调用结果。
 *
 * 设计原则：
 * - 网络细节全部收口在 llm 层，agent 层只关心“拿到结果/拿到错误”；
 * - 错误消息必须可操作，不能只给 `fetch failed` 这类无效信息；
 * - 对可恢复错误（429/5xx/网络抖动）做有限重试，提高稳定性。
 */

const lastRequestAtByProvider = new Map<string, number>();

/**
 * 提取可读的响应片段，避免把整段 HTML/长文本直接塞进错误消息。
 */
function toBodySnippet(bodyText: string, maxChars = 240): string {
  const oneLine = bodyText.replace(/\s+/g, " ").trim();
  if (!oneLine) {
    return "";
  }
  return oneLine.length > maxChars ? `${oneLine.slice(0, maxChars)}...` : oneLine;
}

/**
 * 安全解析响应 JSON。
 *
 * 返回值说明：
 * - `data`：解析成功且为对象时返回；
 * - `parseError`：空字符串响应时为 `null`，解析失败时提供错误文案。
 */
function parseJsonResponse(bodyText: string): {
  data: LlmChatCompletionResponse | null;
  parseError: string | null;
} {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return {
      data: null,
      parseError: null
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        data: null,
        parseError: "Response JSON root is not an object."
      };
    }

    return {
      data: parsed as LlmChatCompletionResponse,
      parseError: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      data: null,
      parseError: `Invalid JSON response: ${message}`
    };
  }
}

/**
 * 计算 provider 的最小请求间隔（毫秒）。
 *
 * 说明：
 * - 允许通过 `LLM_MIN_REQUEST_INTERVAL_MS` 显式覆盖；
 * - 未覆盖时对 zhipu 提供较保守默认值，用于降低 429 触发概率；
 * - 其它 provider 默认 0（不主动等待）。
 */
function getMinIntervalMs(provider: AppConfig["provider"]): number {
  const raw = process.env.LLM_MIN_REQUEST_INTERVAL_MS;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  // Default throttle for zhipu to reduce 429 frequency.
  return provider === "zhipu" ? 2500 : 0;
}

/**
 * 在请求前执行“基于时间戳”的节流等待。
 *
 * 注意：
 * - 这是轻量节流，不是严格队列；
 * - 对单进程顺序请求效果明显；
 * - 对高并发场景仍可能产生瞬时突发（后续可升级为互斥队列方案）。
 */
async function throttleBeforeRequest(config: AppConfig, debug: boolean): Promise<void> {
  const minIntervalMs = getMinIntervalMs(config.provider);
  if (minIntervalMs <= 0) {
    return;
  }

  const now = Date.now();
  const last = lastRequestAtByProvider.get(config.provider) ?? 0;
  const waitMs = Math.max(0, last + minIntervalMs - now);
  if (waitMs > 0) {
    if (debug) {
      console.error(`[debug] throttle waitMs=${waitMs}`);
    }
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastRequestAtByProvider.set(config.provider, Date.now());
}

export async function createChatCompletion(
  config: AppConfig,
  payload: LlmCreateChatCompletionPayload
): Promise<LlmChatCompletionResponse> {
  const endpoint = `${config.baseUrl}/chat/completions`;
  const debug = process.env.CODE_AGENT_DEBUG === "1";
  /**
   * 至少尝试 1 次，防止配置写成 0 后请求被直接跳过。
   * 这里把“重试次数下限”收敛到 1，避免调用方误配置导致静默失败。
   */
  const maxRetries = Number.parseInt(process.env.LLM_MAX_RETRIES ?? "3", 10);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= Math.max(1, maxRetries); attempt += 1) {
    await throttleBeforeRequest(config, debug);
    /**
     * 每次重试都创建独立 AbortController。
     *
     * 原因：
     * - AbortSignal 是一次性状态，复用会导致后续请求被立即中断；
     * - 独立 controller 能保证每次请求都按同一超时策略执行。
     */
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: payload.messages,
          tools: payload.tools,
          tool_choice: "auto",
          stream: false
        }),
        signal: controller.signal
      });

      const rawBody = await response.text();
      const parsedResponse = parseJsonResponse(rawBody);
      const data = parsedResponse.data;

      if (!response.ok) {
        /**
         * 统一 HTTP 非 2xx 分支：
         * - 429/5xx：视为可恢复，优先按 retry-after 或本地退避重试；
         * - 其它状态：直接抛错，避免无效重试浪费时间。
         */
        const bodySnippet = toBodySnippet(rawBody);
        const nonJsonHint = parsedResponse.parseError
          ? `${parsedResponse.parseError}${bodySnippet ? ` Raw body: ${bodySnippet}` : ""}`
          : bodySnippet
            ? `Raw body: ${bodySnippet}`
            : "Empty response body.";
        const errorMessage = data?.error?.message ?? nonJsonHint ?? `HTTP ${response.status}`;
        const isRetriable = response.status === 429 || response.status >= 500;

        if (isRetriable && attempt < maxRetries) {
          // 优先尊重服务端 retry-after；缺失时回退到本地退避策略。
          const retryAfter = response.headers.get("retry-after");
          const retryAfterMs = retryAfter ? Number.parseFloat(retryAfter) * 1000 : 0;
          const backoffMs = Math.max(retryAfterMs || 0, 600 * attempt + Math.floor(Math.random() * 300));
          if (debug) {
            console.error(`[debug] retry attempt=${attempt} status=${response.status} waitMs=${backoffMs}`);
          }
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        if (response.status === 429) {
          // 限流错误单独给出高可读文案，便于用户快速调整频率。
          throw new Error(
            `[${config.provider}] 429 rate limit. Please slow down requests, or try again later. Server message: ${errorMessage}`
          );
        }

        throw new Error(`[${config.provider}] ${response.status} ${errorMessage}`);
      }

      if (!data) {
        const bodySnippet = toBodySnippet(rawBody);
        const detail = parsedResponse.parseError
          ? parsedResponse.parseError
          : bodySnippet
            ? `Raw body: ${bodySnippet}`
            : "Empty response body.";
        throw new Error(`[${config.provider}] Invalid JSON response from ${endpoint}. ${detail}`);
      }

      return data;
    } catch (error) {
      /**
       * 分类型包装错误，保证最终提示“可读、可操作”：
       * - AbortError：明确是超时；
       * - TypeError（fetch层）：尝试提取 cause.code/cause.message；
       * - 其它 Error：保留原始消息并增加 endpoint 上下文。
       */
      if (error instanceof Error && error.name === "AbortError") {
        lastError = new Error(`[${config.provider}] request timed out after ${config.timeoutMs}ms.`);
      } else if (error instanceof TypeError) {
        const cause = (error as Error & { cause?: unknown }).cause;
        const causeMessage =
          cause instanceof Error
            ? cause.message
            : typeof cause === "string"
              ? cause
              : "";
        const code =
          cause && typeof cause === "object" && "code" in cause && typeof (cause as { code?: unknown }).code === "string"
            ? (cause as { code: string }).code
            : "";

        if (code === "ENOTFOUND") {
          // 常见于 DNS 解析失败，直接提示网络/DNS/代理排查方向。
          lastError = new Error(
            `[${config.provider}] Network DNS error (ENOTFOUND) for ${endpoint}. ` +
              `Please check your network/DNS/proxy settings, or switch provider/base URL.`
          );
        } else {
          lastError = new Error(
            `[${config.provider}] Network request failed for ${endpoint}. ` +
              `${causeMessage || error.message}`
          );
        }
      } else if (error instanceof Error) {
        lastError = new Error(`[${config.provider}] Request failed for ${endpoint}. ${error.message}`);
      } else {
        lastError = new Error(`[${config.provider}] Request failed for ${endpoint}. Unknown error.`);
      }

      if (attempt < maxRetries) {
        /**
         * 对 catch 分支执行有限退避重试。
         *
         * 目的：
         * - 吸收短暂网络抖动；
         * - 避免瞬时故障直接失败，提升命令稳定性。
         */
        const backoffMs = 600 * attempt + Math.floor(Math.random() * 300);
        if (debug) {
          console.error(`[debug] retry attempt=${attempt} error waitMs=${backoffMs}`);
        }
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    } finally {
      // 确保 timer 总能释放，避免长时间运行时累积无用定时器。
      clearTimeout(timeout);
    }
  }

  // 理论上不会走到这里；兜底抛错用于防止静默失败。
  throw lastError ?? new Error(`[${config.provider}] Request failed for ${endpoint}.`);
}
