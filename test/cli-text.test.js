const { describe, it } = require("node:test");
const assert = require("node:assert");
const { quoteShellArg, formatChoiceList } = require("../cli-text");

describe("cli text helpers", () => {
  it("formats shell args conservatively for human copy-paste hints", () => {
    assert.strictEqual(quoteShellArg("/repo/path"), "/repo/path");
    assert.strictEqual(quoteShellArg("value with spaces"), "\"value with spaces\"");
    assert.strictEqual(quoteShellArg(""), "\"\"");
    assert.strictEqual(quoteShellArg(null), "\"\"");
  });

  it("formats small choice lists for help text", () => {
    assert.strictEqual(formatChoiceList([]), "");
    assert.strictEqual(formatChoiceList(["updated_at"]), "updated_at");
    assert.strictEqual(formatChoiceList(["created_at", "updated_at"]), "created_at or updated_at");
    assert.strictEqual(
      formatChoiceList(["one", "two", "three"]),
      "one, two, or three"
    );
    assert.strictEqual(
      formatChoiceList(["one", "two"], "and"),
      "one and two"
    );
  });
});
