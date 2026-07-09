const { describe, it } = require("node:test");
const assert = require("node:assert");

const { prefixedSessionId, unprefixedSessionId } = require("../history-session-id");

describe("history session id", () => {
  it("normalizes missing prefixes and trims whitespace", () => {
    assert.strictEqual(prefixedSessionId("019d-thread"), "codex:019d-thread");
    assert.strictEqual(prefixedSessionId(" 019d-thread "), "codex:019d-thread");
    assert.strictEqual(prefixedSessionId(" codex:019d-thread "), "codex:019d-thread");
  });

  it("rejects empty and non-string values", () => {
    assert.strictEqual(prefixedSessionId(""), null);
    assert.strictEqual(prefixedSessionId("   "), null);
    assert.strictEqual(prefixedSessionId(null), null);
  });

  it("can strip the codex prefix back off for exact bridge requests", () => {
    assert.strictEqual(unprefixedSessionId("codex:019d-thread"), "019d-thread");
    assert.strictEqual(unprefixedSessionId(" 019d-thread "), "019d-thread");
    assert.strictEqual(unprefixedSessionId(""), null);
    assert.strictEqual(unprefixedSessionId(null), null);
  });
});
