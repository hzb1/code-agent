import assert from "node:assert/strict";
import test from "node:test";
import { isReadlineClosedError, parseReplControlCommand } from "#src/cli/repl.js";

test("repl: parseReplControlCommand 识别控制命令", () => {
  assert.equal(parseReplControlCommand("/help"), "help");
  assert.equal(parseReplControlCommand("help"), "help");
  assert.equal(parseReplControlCommand("/session"), "session");
  assert.equal(parseReplControlCommand("/last"), "last");
  assert.equal(parseReplControlCommand("clear"), "clear");
  assert.equal(parseReplControlCommand("/clear"), "clear");
  assert.equal(parseReplControlCommand("/plan 重构 queryLoop"), "plan");
  assert.equal(parseReplControlCommand("/approve"), "approve");
  assert.equal(parseReplControlCommand("exit"), "exit");
  assert.equal(parseReplControlCommand("quit"), "exit");
});

test("repl: parseReplControlCommand 未命中时返回 none", () => {
  assert.equal(parseReplControlCommand(""), "none");
  assert.equal(parseReplControlCommand("   "), "none");
  assert.equal(parseReplControlCommand("解释 queryLoop"), "none");
});

test("repl: isReadlineClosedError 能识别关闭类异常", () => {
  const errByCode = Object.assign(new Error("Interface is closed"), { code: "ERR_USE_AFTER_CLOSE" });
  const errByMessage = new Error("readline was closed");
  const normalErr = new Error("network failed");

  assert.equal(isReadlineClosedError(errByCode), true);
  assert.equal(isReadlineClosedError(errByMessage), true);
  assert.equal(isReadlineClosedError(normalErr), false);
  assert.equal(isReadlineClosedError("plain"), false);
});
