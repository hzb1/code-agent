/**
 * Session 层共享类型定义。
 *
 * 设计说明：
 * - 这一层只定义“会话状态快照”的稳定协议，不放运行逻辑；
 * - QueryEngine/REPL/Session Storage 后续都会复用这里的类型；
 * - 先给出 v0.2.0 的最小可用字段，避免过早引入复杂状态机。
 */

/**
 * 单个 read_file 命中的会话缓存条目。
 *
 * 为什么要单独记录：
 * - 多轮追问时，用户常会反复围绕同一文件继续提问；
 * - 该索引可用于后续会话摘要、/session 展示与恢复优化；
 * - 当前只记录轻量元信息，不缓存全文，避免无上限增长。
 */
export type SessionReadFileCacheEntry = {
  /**
   * 工具调用时传入的原始路径（可能是相对路径）。
   */
  path: string;
  /**
   * 解析后的绝对路径，作为去重与聚合主键。
   */
  resolvedPath: string;
  /**
   * 本次读取是否发生截断。
   */
  truncated: boolean;
  /**
   * 当前会话内命中次数。
   */
  readCount: number;
  /**
   * 最近一次读取时间戳（毫秒）。
   */
  lastReadAt: number;
  /**
   * 最近一次读取内容长度（字符数）。
   */
  lastContentChars: number;
};

/**
 * QueryEngine 暴露的只读缓存快照。
 *
 * v0.2.0 只纳入 read_file；后续版本可在不破坏兼容的前提下扩展字段。
 */
export type QuerySessionReadOnlyCache = {
  readFiles: SessionReadFileCacheEntry[];
};

/**
 * QueryEngine 会话状态快照。
 *
 * 使用场景：
 * - REPL 的 `/session` 输出；
 * - Session Storage 的持久化载荷；
 * - doctor/调试阶段的状态可观测输出。
 */
export type QuerySessionState = {
  sessionId: string;
  cwd: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  turnCount: number;
  messageCount: number;
  readOnlyCache: QuerySessionReadOnlyCache;
};

/**
 * Session Storage v1 固定版本号。
 *
 * 说明：
 * - 首版采用单文件 JSON 存储；
 * - 显式版本号可为后续结构升级提供兼容入口。
 */
export type SessionStorageVersion = 1;

/**
 * 会话持久化快照（v1）。
 *
 * 这是磁盘存储结构，不等同于 QueryEngine 内部运行态。
 */
export type PersistedSessionV1 = {
  version: SessionStorageVersion;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  cwd: string;
  model: string;
  turnCount: number;
  messages: Message[];
};
import type { Message } from "../core/message.js";
