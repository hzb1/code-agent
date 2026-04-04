/**
 * 核心错误类型（Core 层）。
 *
 * 设计目标：
 * 1. 把“错误分类”变成显式类型，而不是到处抛裸 Error；
 * 2. 让上层能够基于错误类型做更稳定的处理与日志归类；
 * 3. 为 v0.1.1 的错误收口与测试打基础。
 */

export type AppErrorCode = "CONFIG_ERROR" | "PROVIDER_ERROR" | "TOOL_EXECUTION_ERROR" | "LOOP_TERMINATED_ERROR";

/**
 * 项目基础错误类型。
 *
 * 注意：
 * - `code` 只做“机器可判断”的分类；
 * - 具体可读文案仍由 message 承担，避免丢失排障信息。
 */
export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/**
 * 配置相关错误：例如缺少 API Key、provider/model 非法等。
 */
export class ConfigError extends AppError {
  constructor(message: string) {
    super("CONFIG_ERROR", message);
  }
}

/**
 * Provider 调用层错误：例如返回空消息、协议格式异常、上游不可用等。
 */
export class ProviderError extends AppError {
  constructor(message: string) {
    super("PROVIDER_ERROR", message);
  }
}

/**
 * 工具执行错误：工具不存在、参数非法、运行失败等。
 */
export class ToolExecutionError extends AppError {
  constructor(message: string) {
    super("TOOL_EXECUTION_ERROR", message);
  }
}

/**
 * Agent Loop 终止错误：例如达到最大循环次数仍未收敛。
 */
export class LoopTerminatedError extends AppError {
  constructor(message: string) {
    super("LOOP_TERMINATED_ERROR", message);
  }
}

