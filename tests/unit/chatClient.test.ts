import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../../src/core/config.js";
import { ProviderError } from "../../src/core/errors.js";
import { createChatCompletion } from "../../src/llm/chatClient.js";
import type { LlmCreateChatCompletionPayload } from "../../src/llm/types.js";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    projectRoot: "/tmp/project",
    provider: "qwen",
    apiKey: "test-key",
    baseUrl: "https://example.com/v1",
    model: "test-model",
    maxAgentLoops: 5,
    maxFileChars: 10_000,
    timeoutMs: 1200,
    ...overrides
  };
}

function createPayload(): LlmCreateChatCompletionPayload {
  return {
    messages: [
      {
        role: "user",
        content: "hello"
      }
    ],
    tools: []
  };
}

async function withEnv(overrides: Record<string, string>, run: () => Promise<void>): Promise<void> {
  const keys = Object.keys(overrides);
  const previous = new Map<string, string | undefined>();
  for (const key of keys) {
    previous.set(key, process.env[key]);
    process.env[key] = overrides[key];
  }

  try {
    await run();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function withMockedFetch(
  mockedFetch: typeof fetch,
  run: () => Promise<void>
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockedFetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("chatClient: 403 free tier exhausted 给出权限/额度提示", async () => {
  await withEnv(
    {
      LLM_MAX_RETRIES: "1",
      LLM_MIN_REQUEST_INTERVAL_MS: "0"
    },
    async () => {
      await withMockedFetch(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message:
                  'The free tier of the model has been exhausted. Please disable the "use free tier only" mode.'
              }
            }),
            {
              status: 403,
              statusText: "Forbidden",
              headers: { "Content-Type": "application/json" }
            }
          ),
        async () => {
          await assert.rejects(
            () => createChatCompletion(createConfig(), createPayload()),
            (error) => {
              assert.ok(error instanceof ProviderError);
              assert.match(error.message, /HTTP 403/);
              assert.match(error.message, /权限或额度不足/);
              assert.match(error.message, /free tier/i);
              return true;
            }
          );
        }
      );
    }
  );
});

test("chatClient: 404 空响应提示 baseUrl/model 排查方向", async () => {
  await withEnv(
    {
      LLM_MAX_RETRIES: "1",
      LLM_MIN_REQUEST_INTERVAL_MS: "0"
    },
    async () => {
      await withMockedFetch(
        async () =>
          new Response("", {
            status: 404,
            statusText: "Not Found"
          }),
        async () => {
          await assert.rejects(
            () => createChatCompletion(createConfig(), createPayload()),
            (error) => {
              assert.ok(error instanceof ProviderError);
              assert.match(error.message, /HTTP 404/);
              assert.match(error.message, /LLM_BASE_URL 与 LLM_MODEL/);
              assert.match(error.message, /响应体为空/);
              return true;
            }
          );
        }
      );
    }
  );
});

test("chatClient: 200 但非 JSON 响应会给出可读错误", async () => {
  await withEnv(
    {
      LLM_MAX_RETRIES: "1",
      LLM_MIN_REQUEST_INTERVAL_MS: "0"
    },
    async () => {
      await withMockedFetch(
        async () =>
          new Response("<html>gateway error</html>", {
            status: 200,
            statusText: "OK",
            headers: { "Content-Type": "text/html" }
          }),
        async () => {
          await assert.rejects(
            () => createChatCompletion(createConfig(), createPayload()),
            (error) => {
              assert.ok(error instanceof ProviderError);
              assert.match(error.message, /不是有效 JSON/);
              assert.match(error.message, /无效的 JSON 响应/);
              return true;
            }
          );
        }
      );
    }
  );
});

test("chatClient: DNS 失败会提示检查网络/DNS/代理", async () => {
  await withEnv(
    {
      LLM_MAX_RETRIES: "1",
      LLM_MIN_REQUEST_INTERVAL_MS: "0"
    },
    async () => {
      await withMockedFetch(
        async () => {
          throw new TypeError("fetch failed", {
            cause: {
              code: "ENOTFOUND",
              message: "getaddrinfo ENOTFOUND example.com"
            }
          });
        },
        async () => {
          await assert.rejects(
            () => createChatCompletion(createConfig(), createPayload()),
            (error) => {
              assert.ok(error instanceof ProviderError);
              assert.match(error.message, /DNS 错误/);
              assert.match(error.message, /检查网络\/DNS\/代理配置/);
              return true;
            }
          );
        }
      );
    }
  );
});
