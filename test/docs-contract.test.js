const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const {
  BRIDGE_CANONICAL_THREAD_SOURCE_KINDS,
  BRIDGE_CANONICAL_THREAD_SORT_KEYS,
} = require("../app-server-thread-contract");

const REPO_ROOT = path.resolve(__dirname, "..");
const README_PATH = path.join(REPO_ROOT, "README.md");
const LOCAL_DOC_FILES = [
  "docs/README.md",
  "docs/codex-history-docs-map.md",
  "docs/codex-history-harness.md",
  "docs/codex-history-system-model.md",
  "docs/codex-history-source-grounding.md",
  "docs/codex-history-maintenance.md",
];

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

describe("docs contract", () => {
  it("keeps README links pointed at repo-local docs", () => {
    const readme = readRepoFile("README.md");

    for (const relativePath of LOCAL_DOC_FILES) {
      assert.ok(
        fs.existsSync(path.join(REPO_ROOT, relativePath)),
        `expected ${relativePath} to exist`
      );
    }

    assert.match(readme, /\[docs\/codex-history-harness\.md\]\(\.\/docs\/codex-history-harness\.md\)/);
    assert.match(readme, /\[docs\/codex-history-system-model\.md\]\(\.\/docs\/codex-history-system-model\.md\)/);
    assert.match(readme, /\[docs\/codex-history-source-grounding\.md\]\(\.\/docs\/codex-history-source-grounding\.md\)/);
    assert.match(readme, /\[docs\/codex-history-docs-map\.md\]\(\.\/docs\/codex-history-docs-map\.md\)/);
    assert.match(readme, /\[docs\/codex-history-maintenance\.md\]\(\.\/docs\/codex-history-maintenance\.md\)/);
    assert.doesNotMatch(readme, /\.\.\/docs\//);
  });

  it("rejects stale repo-layout and CLI path guidance in README and local docs", () => {
    const docsText = [readRepoFile("README.md"), ...LOCAL_DOC_FILES.map(readRepoFile)].join("\n");

    assert.doesNotMatch(docsText, /\bcd codex\b/);
    assert.doesNotMatch(docsText, /\bnode codex\/history\.js\b/);
    assert.doesNotMatch(docsText, /createdAt\s+or\s+updatedAt/);
    assert.doesNotMatch(docsText, /sort=createdAt\|updatedAt/);
  });

  it("documents the canonical bridge thread sort keys and source kinds", () => {
    const readme = readRepoFile("README.md");
    const sourceGrounding = readRepoFile("docs/codex-history-source-grounding.md");

    assert.match(
      readme,
      new RegExp(`sort=${BRIDGE_CANONICAL_THREAD_SORT_KEYS.join("\\|")}`)
    );
    assert.match(
      sourceGrounding,
      new RegExp(`sort aliases normalize to \`${BRIDGE_CANONICAL_THREAD_SORT_KEYS[0]}\` or \`${BRIDGE_CANONICAL_THREAD_SORT_KEYS[1]}\``)
    );

    for (const sourceKind of BRIDGE_CANONICAL_THREAD_SOURCE_KINDS) {
      assert.match(sourceGrounding, new RegExp(`- \`${sourceKind}\``));
    }
  });

  it("documents the harness-only install footprint and codex cli dependency", () => {
    const readme = readRepoFile("README.md");
    const harnessGuide = readRepoFile("docs/codex-history-harness.md");

    assert.match(readme, /harness-only/);
    assert.match(readme, /working `codex` CLI on `PATH`/);
    assert.match(harnessGuide, /working `codex` CLI on `PATH`/);
  });

  it("keeps the docs index explicit about executable smoke-covered examples", () => {
    const docsIndex = readRepoFile("docs/README.md");

    assert.match(docsIndex, /\[codex-history-docs-map\.md\]\(\.\/codex-history-docs-map\.md\)/);
    assert.match(docsIndex, /\[codex-history-maintenance\.md\]\(\.\/codex-history-maintenance\.md\)/);
    assert.match(docsIndex, /## Start Here/);
    assert.match(docsIndex, /canonical docs home/i);
    assert.match(docsIndex, /## Executable Examples/);
    assert.match(docsIndex, /\[test\/readme-smoke\.test\.js\]\(\.\.\/test\/readme-smoke\.test\.js\)/);
    assert.match(docsIndex, /npm run history -- overview/);
    assert.match(docsIndex, /npm run history -- family \.\.\./);
    assert.match(docsIndex, /npm run history -- workstream \.\.\. --json --pretty --compact/);
    assert.match(docsIndex, /cmem threads --sort updated_at --model-provider openai --source-kind cli/);
    assert.match(docsIndex, /representative smoke checks, not exhaustive docs coverage/);
  });

  it("keeps maintenance docs focused on module boundaries and next worthwhile work", () => {
    const maintenanceDoc = readRepoFile("docs/codex-history-maintenance.md");

    assert.match(maintenanceDoc, /## Current High-Level Picture/);
    assert.match(maintenanceDoc, /## Invariants To Protect/);
    assert.match(maintenanceDoc, /## Current Test Layers/);
    assert.match(maintenanceDoc, /## Best Next Tests To Add/);
    assert.match(maintenanceDoc, /## Best Investigation Lanes/);
    assert.match(maintenanceDoc, /## What Not To Do Next/);
  });

  it("keeps the docs map explicit about canonical homes, ownership, and runtime checkpoints", () => {
    const docsMap = readRepoFile("docs/codex-history-docs-map.md");

    assert.match(docsMap, /## Canonical Documentation Homes/);
    assert.match(docsMap, /## Stable Feature Families/);
    assert.match(docsMap, /## Subsystem Ownership By Layer/);
    assert.match(docsMap, /## Runtime Checkpoints/);
    assert.match(docsMap, /## Live Verification And Test-Backed Verification/);
    assert.match(docsMap, /node bin\/cmem\.js status/);
    assert.match(docsMap, /npm run history -- overview/);
    assert.match(docsMap, /node history\.js threads --limit 3/);
  });
});
