const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const { createCatalogRolloutBuild } = require("../catalog-rollout-build");

const tempPaths = [];

function createRolloutBuild(overrides = {}) {
  return createCatalogRolloutBuild({
    fs,
    prefixedSessionId(value) {
      if (typeof value !== "string" || !value.trim()) return "";
      const text = value.trim();
      return text.startsWith("codex:") ? text : `codex:${text}`;
    },
    extractSessionIdFromFilePath(filePath) {
      const base = path.basename(String(filePath || ""));
      const match = base.match(/rollout-(.+)\.jsonl?$/);
      return match ? match[1] : "";
    },
    normalizeHistoryMode(value) {
      return String(value || "").trim().toLowerCase() === "raw" ? "raw" : "effective";
    },
    normalizeRecordObject(value) {
      return value;
    },
    logEventMap: {},
    createSessionDocument() {
      throw new Error("not needed in this test");
    },
    finalizeSession(session) {
      return session;
    },
    toTimestampMs(value) {
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : 0;
    },
    noteSearchBucket() {},
    noteRolloutPersistence() {},
    ensureTurn() {
      return null;
    },
    summarizeText(value) {
      return typeof value === "string" ? value : String(value || "");
    },
    addUnique(list, value, limit = 50) {
      if (!value || list.includes(value) || list.length >= limit) return;
      list.push(value);
    },
    noteTurnTool() {},
    getCommandPathRoles() {
      return [];
    },
    normalizeReferencedPath(_cwd, value) {
      return typeof value === "string" ? value : "";
    },
    normalizeReferencedPathPattern(_cwd, value) {
      return typeof value === "string" ? value : "";
    },
    pushBounded(list, item, limit) {
      list.push(item);
      while (list.length > limit) list.shift();
    },
    MAX_RECENT_COMMANDS: 12,
    MAX_TURN_ITEMS: 20,
    MAX_COMMAND_ARTIFACTS: 120,
    noteTurnCommandType() {},
    noteSessionPath() {},
    noteTurnPath() {},
    MAX_PATH_ARTIFACTS: 160,
    noteSessionPathPattern() {},
    noteTurnPathPattern() {},
    noteTurnFile() {
      return "";
    },
    normalizeTouchedFilePath(_cwd, value) {
      return typeof value === "string" ? value : "";
    },
    noteSessionFile() {},
    noteTurnQuery() {},
    MAX_RECENT_QUERIES: 12,
    MAX_QUERY_ARTIFACTS: 120,
    buildNormalizedErrorDetail(error) {
      return error && error.message ? error.message : "";
    },
    buildNormalizedErrorSearchValues(error) {
      return error && error.message ? [error.message] : [];
    },
    MAX_RECENT_ERRORS: 12,
    MAX_ERROR_ARTIFACTS: 120,
    ...overrides,
  });
}

function writeTempFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-rollout-build-"));
  tempPaths.push(dir);
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

afterEach(() => {
  while (tempPaths.length) {
    fs.rmSync(tempPaths.pop(), { recursive: true, force: true });
  }
});

describe("catalog rollout build", () => {
  it("normalizes legacy flat rollout objects and ignores materialized session docs", () => {
    const rollout = createRolloutBuild();

    const legacyObjects = rollout.loadRolloutObjects("rollout-legacy.json", JSON.stringify({
      session: {
        id: "legacy-id",
        timestamp: "2026-04-20T10:00:00.000Z",
        cwd: "/repo",
      },
      items: [
        { role: "user", content: "hello" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call-1",
              function: {
                name: "shell",
                arguments: "{\"cmd\":\"pwd\"}",
              },
            },
          ],
        },
      ],
    }));

    assert.strictEqual(legacyObjects.length, 3);
    assert.strictEqual(legacyObjects[0].type, "session_meta");
    assert.strictEqual(legacyObjects[1].type, "message");
    assert.strictEqual(legacyObjects[2].payload.type, "function_call");

    const materialized = rollout.loadRolloutObjects("rollout-doc.jsonl", JSON.stringify({
      schemaVersion: 22,
      historyMode: "effective",
      sessionId: "codex:s-1",
      turns: [],
    }));

    assert.deepStrictEqual(materialized, []);
  });

  it("routes Responses-style legacy items through the response_item path", () => {
    const rollout = createRolloutBuild();

    const legacyObjects = rollout.loadRolloutObjects("rollout-legacy.json", JSON.stringify({
      session: {
        id: "legacy-id",
        timestamp: "2025-04-17T00:24:16.452Z",
      },
      items: [
        { type: "reasoning", summary: [], duration_ms: 3866 },
        {
          type: "function_call",
          name: "shell",
          arguments: "{\"command\":[\"bash\",\"-lc\",\"ls\"]}",
          call_id: "call-legacy-1",
        },
        {
          type: "function_call_output",
          call_id: "call-legacy-1",
          output: "{\"output\":\"README.md\\n\",\"metadata\":{\"exit_code\":0,\"duration_seconds\":0.1}}",
        },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "list the files" }],
        },
      ],
    }));

    assert.strictEqual(legacyObjects.length, 5);
    assert.strictEqual(legacyObjects[0].type, "session_meta");
    assert.strictEqual(legacyObjects[1].type, "response_item");
    assert.strictEqual(legacyObjects[1].payload.type, "reasoning");
    assert.strictEqual(legacyObjects[2].payload.type, "function_call");
    assert.strictEqual(legacyObjects[2].payload.call_id, "call-legacy-1");
    assert.strictEqual(legacyObjects[3].payload.type, "function_call_output");
    assert.strictEqual(legacyObjects[4].type, "message");
    assert.strictEqual(legacyObjects[4].role, "user");
  });

  it("marks rolled-back turn events as excluded from effective history", () => {
    const rollout = createRolloutBuild();
    const filePath = writeTempFile("rollout-thread-1.jsonl", [
      JSON.stringify({
        kind: "session_meta",
        timestamp: "2026-04-20T10:00:00.000Z",
        sessionMeta: { id: "thread-1", cwd: "/repo" },
      }),
      JSON.stringify({
        kind: "turn_context",
        timestamp: "2026-04-20T10:01:00.000Z",
        turnContext: { turnId: "turn-1", cwd: "/repo" },
      }),
      JSON.stringify({
        kind: "message",
        timestamp: "2026-04-20T10:01:10.000Z",
        turnId: "turn-1",
        role: "user",
        text: "first turn",
      }),
      JSON.stringify({
        kind: "turn_context",
        timestamp: "2026-04-20T10:02:00.000Z",
        turnContext: { turnId: "turn-2", cwd: "/repo" },
      }),
      JSON.stringify({
        kind: "message",
        timestamp: "2026-04-20T10:02:10.000Z",
        turnId: "turn-2",
        role: "user",
        text: "second turn",
      }),
      JSON.stringify({
        kind: "history_mutation",
        timestamp: "2026-04-20T10:03:00.000Z",
        mutation: { type: "thread_rollback", numTurns: 1 },
      }),
    ].join("\n"));

    const normalized = rollout.readNormalizedSessionEvents(filePath);
    const effectiveEvents = rollout.selectNormalizedEvents(normalized, "effective");
    const rawEvents = rollout.selectNormalizedEvents(normalized, "raw");

    assert.strictEqual(normalized.sessionId, "codex:thread-1");
    assert.deepStrictEqual(normalized.finalTurnIds, ["turn-1"]);
    assert.strictEqual(rawEvents.length, 6);

    const effectiveTurnIds = effectiveEvents
      .map((item) => item.resolvedTurnId)
      .filter(Boolean);
    assert.deepStrictEqual(effectiveTurnIds, ["turn-1", "turn-1"]);
    assert.ok(
      rawEvents.some((item) => item.resolvedTurnId === "turn-2" && item.includedInFinalHistory === false)
    );
  });
});
