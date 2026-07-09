const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const runtimeConfig = require("../runtime-config");

const tempDirs = [];

function makeTempRuntimePath() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-runtime-"));
  tempDirs.push(tmpDir);
  return path.join(tmpDir, "runtime.json");
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("runtime-config helpers", () => {
  it("writes and clears runtime config", () => {
    const runtimePath = makeTempRuntimePath();
    assert.strictEqual(runtimeConfig.writeRuntimeConfig(24633, runtimePath), true);
    assert.strictEqual(runtimeConfig.readRuntimePort(runtimePath), 24633);
    assert.strictEqual(runtimeConfig.clearRuntimeConfig(runtimePath), true);
    assert.strictEqual(runtimeConfig.readRuntimePort(runtimePath), null);
  });

  it("prioritizes preferred and runtime ports", () => {
    const result = runtimeConfig.splitPortCandidates(24635, { runtimePort: 24634 });
    assert.deepStrictEqual(result.direct, [24635, 24634]);
    assert.ok(result.fallback.includes(24633));
    assert.ok(!result.fallback.includes(24634));
    assert.ok(!result.fallback.includes(24635));
  });

  it("preserves explicit preferred ports outside the default fallback range", () => {
    const result = runtimeConfig.splitPortCandidates(24639, { runtimePort: 24634 });
    assert.deepStrictEqual(result.direct, [24639, 24634]);
    assert.ok(result.fallback.includes(24633));
    assert.ok(!result.fallback.includes(24634));
    assert.ok(!result.fallback.includes(24639));
  });

  it("recognizes signed backend responses", async () => {
    await new Promise((resolve, reject) => {
      const req = {
        on(event, handler) {
          if (event === "error" || event === "timeout") this[`_${event}`] = handler;
        },
        destroy() {}
      };

      runtimeConfig.probePort(24637, 100, (ok) => {
        try {
          assert.strictEqual(ok, true);
          resolve();
        } catch (err) {
          reject(err);
        }
      }, {
        httpGet(_options, onResponse) {
          const res = {
            headers: { "x-codex-backend": "clawd-codex-backend" },
            setEncoding() {},
            on(event, handler) {
              if (event === "data") handler("");
              if (event === "end") handler();
            }
          };
          onResponse(res);
          return req;
        }
      });
    });
  });
});
