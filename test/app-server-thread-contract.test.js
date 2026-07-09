const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  BRIDGE_CANONICAL_THREAD_SORT_KEYS,
  BRIDGE_CANONICAL_THREAD_SOURCE_KINDS,
  normalizeBridgeOptionalBoolean,
  normalizeBridgeThreadId,
  requireBridgeThreadId,
  normalizeBridgeThreadMemoryMode,
  normalizeBridgeGitInfoPatch,
  requireBridgeGitInfoPatch,
  normalizeBridgeThreadSortKey,
  normalizeBridgeThreadSourceKind,
  normalizeBridgeThreadListParams,
  normalizeBridgeLoadedListParams,
  normalizeBridgeRollbackTurns,
  normalizeBridgeThreadName,
  requireBridgeThreadPayload,
} = require("../app-server-thread-contract");

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

describe("app-server thread contract", () => {
  it("normalizes bridge thread ids from prefixed session ids", () => {
    assert.strictEqual(normalizeBridgeThreadId("codex:019d-thread"), "019d-thread");
    assert.strictEqual(normalizeBridgeThreadId(" 019d-thread "), "019d-thread");
    assert.strictEqual(normalizeBridgeThreadId(""), "");
    assert.throws(
      () => requireBridgeThreadId("   "),
      (err) => err && err.code === "APP_SERVER_INVALID_THREAD"
    );
  });

  it("normalizes memory mode values consistently", () => {
    assert.strictEqual(normalizeBridgeThreadMemoryMode(" ENABLED "), "enabled");
    assert.strictEqual(normalizeBridgeThreadMemoryMode("disabled"), "disabled");
    assert.throws(
      () => normalizeBridgeThreadMemoryMode("polluted"),
      (err) => err && err.code === "APP_SERVER_INVALID_MEMORY_MODE"
    );
  });

  it("normalizes git metadata patches with trim and clear semantics", () => {
    assert.deepStrictEqual(
      normalizeBridgeGitInfoPatch({
        branch: " main ",
        sha: null,
        originUrl: " https://example.test/repo.git ",
      }),
      {
        branch: "main",
        sha: null,
        originUrl: "https://example.test/repo.git",
      }
    );
    assert.strictEqual(normalizeBridgeGitInfoPatch({}), null);
    assert.throws(
      () => requireBridgeGitInfoPatch({ branch: "   " }),
      (err) => err && err.code === "APP_SERVER_INVALID_METADATA"
    );
    assert.throws(
      () => requireBridgeGitInfoPatch(null),
      (err) => err && err.code === "APP_SERVER_INVALID_METADATA"
    );
  });

  it("normalizes rollback turns and thread names", () => {
    assert.strictEqual(normalizeBridgeRollbackTurns("2"), 2);
    assert.strictEqual(normalizeBridgeThreadName(" Backend parser "), "Backend parser");
    assert.throws(
      () => normalizeBridgeRollbackTurns(0),
      (err) => err && err.code === "APP_SERVER_INVALID_ROLLBACK"
    );
    assert.throws(
      () => normalizeBridgeThreadName("   "),
      (err) => err && err.code === "APP_SERVER_INVALID_NAME"
    );
  });

  it("normalizes exact thread-list filters to upstream wire values", () => {
    assert.strictEqual(normalizeBridgeOptionalBoolean(" yes "), true);
    assert.strictEqual(normalizeBridgeThreadSortKey("updated_at"), "updated_at");
    assert.strictEqual(normalizeBridgeThreadSourceKind("sub-agent-thread-spawn"), "subAgentThreadSpawn");
    assert.deepStrictEqual(
      normalizeBridgeThreadListParams({
        cursor: " cursor-2 ",
        limit: "5",
        sort: "updated_at",
        sortDirection: "Descending",
        useStateDbOnly: "yes",
        modelProviders: [" openai ", "openai", "anthropic"],
        sourceKinds: ["sub-agent-thread-spawn", "cli"],
        archived: "false",
        cwd: " /repo/a ",
        q: " backend ",
      }),
      {
        cursor: "cursor-2",
        limit: 5,
        sortKey: "updated_at",
        sortDirection: "desc",
        useStateDbOnly: true,
        modelProviders: ["openai", "anthropic"],
        sourceKinds: ["subAgentThreadSpawn", "cli"],
        archived: false,
        cwd: "/repo/a",
        searchTerm: "backend",
      }
    );
    assert.throws(
      () => normalizeBridgeThreadListParams({ sortDirection: "sideways" }),
      (err) => err && err.code === "APP_SERVER_INVALID_THREAD_LIST"
    );
    assert.deepStrictEqual(
      normalizeBridgeLoadedListParams({
        cursor: " loaded-2 ",
        limit: "3",
      }),
      {
        cursor: "loaded-2",
        limit: 3,
      }
    );
    assert.throws(
      () => normalizeBridgeThreadListParams({ sourceKinds: ["not-real"] }),
      (err) => err && err.code === "APP_SERVER_INVALID_THREAD_LIST"
    );
    assert.throws(
      () => normalizeBridgeThreadListParams({ modelProviders: "" }),
      /model-provider value is required/
    );
    assert.throws(
      () => normalizeBridgeThreadListParams({ sortKey: "" }),
      /sort key is required/
    );
    assert.throws(
      () => normalizeBridgeThreadListParams({ sourceKinds: "" }),
      /source-kind value is required/
    );
    assert.deepStrictEqual(
      normalizeBridgeThreadListParams({
        modelProviders: [],
        sourceKinds: [],
      }),
      {
        cursor: undefined,
        limit: undefined,
        sortKey: undefined,
        sortDirection: undefined,
        useStateDbOnly: undefined,
        modelProviders: [],
        sourceKinds: [],
        archived: null,
        cwd: undefined,
        searchTerm: undefined,
      }
    );
  });

  it("stays aligned with the local upstream thread-list schema", (t) => {
    const sortKeySchemaPath = path.join(__dirname, "..", "codex", "codex-rs", "app-server-protocol", "schema", "typescript", "v2", "ThreadSortKey.ts");
    if (!fs.existsSync(sortKeySchemaPath)) {
      t.skip("codex submodule not initialized (git submodule update --init) — upstream parity check skipped");
      return;
    }
    const upstreamSortKeys = parseTypeScriptStringUnion(
      sortKeySchemaPath,
      "ThreadSortKey"
    );
    const upstreamSourceKinds = parseTypeScriptStringUnion(
      path.join(__dirname, "..", "codex", "codex-rs", "app-server-protocol", "schema", "typescript", "v2", "ThreadSourceKind.ts"),
      "ThreadSourceKind"
    );

    assert.deepStrictEqual(BRIDGE_CANONICAL_THREAD_SORT_KEYS, upstreamSortKeys);
    assert.deepStrictEqual(BRIDGE_CANONICAL_THREAD_SOURCE_KINDS, upstreamSourceKinds);

    for (const value of upstreamSortKeys) {
      assert.strictEqual(normalizeBridgeThreadSortKey(value), value);
    }
    for (const value of upstreamSourceKinds) {
      assert.strictEqual(normalizeBridgeThreadSourceKind(value), value);
    }
  });

  it("validates thread payload responses", () => {
    const response = {
      thread: {
        id: "019d-thread",
      },
    };
    assert.strictEqual(requireBridgeThreadPayload(response, "thread/read"), response.thread);
    assert.throws(
      () => requireBridgeThreadPayload({}, "thread/read"),
      (err) => err && err.code === "APP_SERVER_INVALID_RESPONSE"
    );
  });
});
