import assert from "node:assert/strict";
import test from "node:test";
import { parseReplControlCommand } from "../../src/cli/repl.js";

test("repl: parseReplControlCommand 识别控制命令", () => {
  assert.equal(parseReplControlCommand("/help"), "help");
  assert.equal(parseReplControlCommand("help"), "help");
  assert.equal(parseReplControlCommand("/session"), "session");
  assert.equal(parseReplControlCommand("/last"), "last");
  assert.equal(parseReplControlCommand("clear"), "clear");
  assert.equal(parseReplControlCommand("/clear"), "clear");
  assert.equal(parseReplControlCommand("exit"), "exit");
  assert.equal(parseReplControlCommand("quit"), "exit");
});

test("repl: parseReplControlCommand 未命中时返回 none", () => {
  assert.equal(parseReplControlCommand(""), "none");
  assert.equal(parseReplControlCommand("   "), "none");
  assert.equal(parseReplControlCommand("解释 queryLoop"), "none");
});
