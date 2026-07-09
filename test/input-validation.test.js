const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  createArgReaders,
  readOptionalQueryInteger,
  readOptionalBodyInteger,
} = require("../input-validation");

describe("input validation", () => {
  it("reads required argv values and constrained integers with default errors", () => {
    const readers = createArgReaders();

    assert.strictEqual(
      readers.readRequiredOptionValue(["--cwd", "/repo"], 0, "--cwd"),
      "/repo"
    );
    assert.strictEqual(
      readers.readPositiveIntegerOptionValue(["--limit", "3"], 0, "--limit"),
      3
    );
    assert.strictEqual(
      readers.readNonNegativeIntegerOptionValue(["--offset", "0"], 0, "--offset"),
      0
    );

    assert.throws(
      () => readers.readRequiredOptionValue(["--cwd"], 0, "--cwd"),
      /--cwd value is required/
    );
    assert.throws(
      () => readers.readPositiveIntegerOptionValue(["--limit", "0"], 0, "--limit"),
      /--limit must be a positive integer/
    );
    assert.throws(
      () => readers.readPositiveIntegerOptionValue(["--limit", "abc"], 0, "--limit"),
      /--limit must be an integer/
    );
    assert.throws(
      () => readers.readNonNegativeIntegerOptionValue(["--offset", "-1"], 0, "--offset"),
      /--offset must be a non-negative integer/
    );
  });

  it("supports custom error factories for cli-specific error shaping", () => {
    const readers = createArgReaders({
      errorFactory(message) {
        const err = new Error(message);
        err.code = "CUSTOM_INPUT";
        return err;
      },
    });

    assert.throws(
      () => readers.readPositiveIntegerOptionValue(["--limit", "0"], 0, "--limit"),
      (err) => err && err.code === "CUSTOM_INPUT" && /--limit must be a positive integer/.test(err.message)
    );
  });

  it("validates optional query integers with positive and non-negative contracts", () => {
    const params = new URLSearchParams("limit=5&offset=0");

    assert.strictEqual(
      readOptionalQueryInteger(params, ["limit"], { label: "limit", positive: true }),
      5
    );
    assert.strictEqual(
      readOptionalQueryInteger(params, ["offset"], { label: "offset", nonNegative: true }),
      0
    );
    assert.strictEqual(
      readOptionalQueryInteger(new URLSearchParams(), ["limit"], { label: "limit", positive: true }),
      undefined
    );

    assert.throws(
      () => readOptionalQueryInteger(new URLSearchParams("limit=0"), ["limit"], { label: "limit", positive: true }),
      /limit must be a positive integer/
    );
    assert.throws(
      () => readOptionalQueryInteger(new URLSearchParams("offset=-1"), ["offset"], { label: "offset", nonNegative: true }),
      /offset must be a non-negative integer/
    );
  });

  it("validates optional body integers only when the field is present", () => {
    assert.strictEqual(
      readOptionalBodyInteger({ limit: "2" }, ["limit"], { label: "limit", positive: true }),
      2
    );
    assert.strictEqual(
      readOptionalBodyInteger({}, ["limit"], { label: "limit", positive: true }),
      undefined
    );
    assert.throws(
      () => readOptionalBodyInteger({ drop_last: 0 }, ["drop_last"], { label: "drop_last", positive: true }),
      /drop_last must be a positive integer/
    );
  });
});
