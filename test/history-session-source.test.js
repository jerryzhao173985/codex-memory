const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { normalizeSessionSource } = require("../history-session-source");

function parseTypeScriptStringUnion(filePath, typeName) {
  const source = fs.readFileSync(filePath, "utf8");
  const pattern = new RegExp(`export type ${typeName} = ([^;]+);`);
  const match = source.match(pattern);
  assert.ok(match, `missing ${typeName} union in ${filePath}`);
  return match[1]
    .split("|")
    .map((entry) => entry.trim())
    .filter((entry) => /^".+"$/.test(entry))
    .map((entry) => entry.slice(1, -1));
}

describe("history session source", () => {
  it("normalizes rollout and bridge builtin source strings consistently", () => {
    assert.deepStrictEqual(normalizeSessionSource("vscode"), {
      source: "vscode",
      sourceKind: "vscode",
      sourceDetail: null,
    });
    assert.deepStrictEqual(normalizeSessionSource("mcp"), {
      source: "appServer",
      sourceKind: "appServer",
      sourceDetail: null,
    });
  });

  it("normalizes snake_case rollout subagent thread spawn sources", () => {
    assert.deepStrictEqual(normalizeSessionSource({
      subagent: {
        thread_spawn: {
          parent_thread_id: "019d-parent",
          depth: 2,
          agent_path: "agents/reviewer",
          agent_nickname: "worker",
          agent_role: "reviewer",
        },
      },
    }), {
      source: "subAgentThreadSpawn",
      sourceKind: "subAgentThreadSpawn",
      sourceDetail: {
        type: "subAgent",
        variant: "threadSpawn",
        parentThreadId: "codex:019d-parent",
        depth: 2,
        agentPath: "agents/reviewer",
        agentNickname: "worker",
        agentRole: "reviewer",
      },
    });
  });

  it("normalizes app-server session source objects consistently", () => {
    assert.deepStrictEqual(normalizeSessionSource({
      subAgent: {
        memoryConsolidation: {},
      },
    }), {
      source: "subAgent",
      sourceKind: "subAgent",
      sourceDetail: {
        type: "subAgent",
        variant: "memoryConsolidation",
      },
    });
  });

  it("stays aligned with builtin upstream SessionSource strings", (t) => {
    const sessionSourceSchemaPath = path.join(__dirname, "..", "codex", "codex-rs", "app-server-protocol", "schema", "typescript", "v2", "SessionSource.ts");
    if (!fs.existsSync(sessionSourceSchemaPath)) {
      t.skip("codex submodule not initialized (git submodule update --init) — upstream parity check skipped");
      return;
    }
    const upstreamBuiltinSources = parseTypeScriptStringUnion(
      sessionSourceSchemaPath,
      "SessionSource"
    );

    assert.deepStrictEqual(upstreamBuiltinSources, [
      "cli",
      "vscode",
      "exec",
      "appServer",
      "unknown",
    ]);

    for (const value of upstreamBuiltinSources) {
      assert.deepStrictEqual(normalizeSessionSource(value), {
        source: value,
        sourceKind: value,
        sourceDetail: null,
      });
    }
  });
});
