const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const NPM_CMD = process.platform === "win32" ? "npm.cmd" : "npm";

function runPackDryRun() {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-pack-contract-"));
  try {
    const raw = execFileSync(NPM_CMD, [
      "pack",
      "--json",
      "--dry-run",
      "--cache",
      cacheDir,
    ], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const parsed = JSON.parse(raw);
    assert.ok(Array.isArray(parsed) && parsed.length > 0, "expected npm pack --json output");
    return parsed[0];
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
}

describe("package contract", () => {
  it("keeps global install tarballs scoped to the harness runtime", () => {
    const packed = runPackDryRun();
    const filePaths = Array.isArray(packed.files)
      ? packed.files.map((entry) => entry.path)
      : [];

    assert.ok(filePaths.includes("bin/cmem.js"));
    assert.ok(filePaths.includes("history.js"));
    assert.ok(filePaths.includes("server.js"));
    assert.ok(filePaths.includes("README.md"));

    assert.ok(!filePaths.some((entry) => entry.startsWith("codex/")));
    assert.ok(!filePaths.some((entry) => entry.startsWith("test/")));
    assert.ok(!filePaths.includes(".DS_Store"));
  });
});
