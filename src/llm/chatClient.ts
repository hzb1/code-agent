import type { AppConfig } from "../core/config.js";

export type ChatFunctionTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatFunctionCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ChatFunctionCall[];
  tool_call_id?: string;
  name?: string;
};

type ChatCompletionResponse = {
  id: string;
  choices?: Array<{
    message?: ChatMessage;
  }>;
  error?: {
    message?: string;
    code?: string;
  };
};

const lastRequestAtByProvider = new Map<string, number>();

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
  payload: {
    messages: ChatMessage[];
    tools?: ChatFunctionTool[];
  }
): Promise<ChatCompletionResponse> {
  const endpoint = `${config.baseUrl}/chat/completions`;
  const debug = process.env.CODE_AGENT_DEBUG === "1";
  const maxRetries = Number.parseInt(process.env.LLM_MAX_RETRIES ?? "3", 10);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= Math.max(1, maxRetries); attempt += 1) {
    await throttleBeforeRequest(config, debug);
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

      const data = (await response.json()) as ChatCompletionResponse;

      if (!response.ok) {
        const errorMessage = data.error?.message ?? `HTTP ${response.status}`;
        const isRetriable = response.status === 429 || response.status >= 500;

        if (isRetriable && attempt < maxRetries) {
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
          throw new Error(
            `[${config.provider}] 429 rate limit. Please slow down requests, or try again later. Server message: ${errorMessage}`
          );
        }

        throw new Error(`[${config.provider}] ${response.status} ${errorMessage}`);
      }

      return data;
    } catch (error) {
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
        const backoffMs = 600 * attempt + Math.floor(Math.random() * 300);
        if (debug) {
          console.error(`[debug] retry attempt=${attempt} error waitMs=${backoffMs}`);
        }
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error(`[${config.provider}] Request failed for ${endpoint}.`);
}
