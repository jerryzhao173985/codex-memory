const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  HISTORY_INDEX_VERSION,
  DEFAULT_HISTORY_INDEX_ROOT,
  resolveHistoryIndexRoot,
  buildRolloutPersistenceStats,
  buildPersistentHistoryIndex,
} = require("../history-store-index");

function makeTempDirs() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-history-index-"));
  const sessionDir = path.join(rootDir, "sessions");
  const dateDir = path.join(sessionDir, "2026", "04", "09");
  const indexDir = path.join(rootDir, "index");
  fs.mkdirSync(dateDir, { recursive: true });
  return { rootDir, sessionDir, dateDir, indexDir };
}

function writeRollout(dateDir, fileName, records) {
  fs.writeFileSync(path.join(dateDir, fileName), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

function writeLegacyRollout(sessionDir, fileName, session, items) {
  fs.writeFileSync(path.join(sessionDir, fileName), JSON.stringify({ session, items }, null, 2));
}

const FILE_A = "rollout-2026-04-09T15-10-51-019d23d4-f1a9-7633-b9c7-758327137228.jsonl";
const FILE_B = "rollout-2026-04-09T16-10-51-019d23d4-f1a9-7633-b9c7-758327137229.jsonl";

describe("history store index", () => {
  let rootDir;
  let sessionDir;
  let dateDir;
  let indexDir;

  beforeEach(() => {
    ({ rootDir, sessionDir, dateDir, indexDir } = makeTempDirs());
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("resolves index roots consistently", () => {
    assert.strictEqual(resolveHistoryIndexRoot(), DEFAULT_HISTORY_INDEX_ROOT);
    assert.strictEqual(resolveHistoryIndexRoot(""), DEFAULT_HISTORY_INDEX_ROOT);
    assert.strictEqual(
      resolveHistoryIndexRoot("~/codex-index"),
      path.join(os.homedir(), "codex-index")
    );
    assert.strictEqual(resolveHistoryIndexRoot("/tmp/custom-index"), "/tmp/custom-index");
  });

  it("builds and reuses unchanged persistent session docs directly", () => {
    writeRollout(dateDir, FILE_A, [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "index-session",
          cwd: "/repo/a",
          memory_mode: "disabled",
        },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-1",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_1",
          arguments: "{\"cmd\":\"pwd\",\"workdir\":\"/repo/a\"}",
        },
      },
    ]);

    const first = buildPersistentHistoryIndex({ sessionDir, indexRoot: indexDir });
    assert.strictEqual(first.catalog.sessionCount, 1);
    assert.strictEqual(first.manifest.version, HISTORY_INDEX_VERSION);
    assert.strictEqual(first.manifest.stats.rebuiltFiles, 1);
    assert.strictEqual(first.manifest.stats.reusedFiles, 0);
    assert.deepStrictEqual(first.manifest.stats.memoryModeCounts, { disabled: 1 });
    assert.ok(fs.existsSync(path.join(indexDir, "manifest.json")));

    const second = buildPersistentHistoryIndex({ sessionDir, indexRoot: indexDir });
    assert.strictEqual(second.catalog.sessionCount, 1);
    assert.strictEqual(second.manifest.stats.rebuiltFiles, 0);
    assert.strictEqual(second.manifest.stats.reusedFiles, 1);
    assert.strictEqual(second.manifest.stats.reuseCandidates, 1);
    assert.strictEqual(second.manifest.stats.reuseFailures, 0);
  });

  it("removes stale session docs when rollout files disappear", () => {
    writeRollout(dateDir, FILE_A, [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "index-session-a",
          cwd: "/repo/a",
        },
      },
    ]);
    writeRollout(dateDir, FILE_B, [
      {
        timestamp: "2026-04-09T16:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "index-session-b",
          cwd: "/repo/b",
        },
      },
    ]);

    const first = buildPersistentHistoryIndex({ sessionDir, indexRoot: indexDir });
    const firstDocPaths = Object.values(first.manifest.files).map((entry) => entry.docPath);
    assert.strictEqual(firstDocPaths.length, 2);
    assert.ok(firstDocPaths.every((docPath) => fs.existsSync(path.join(indexDir, docPath))));

    fs.unlinkSync(path.join(dateDir, FILE_B));

    const second = buildPersistentHistoryIndex({ sessionDir, indexRoot: indexDir });
    assert.strictEqual(second.catalog.sessionCount, 1);
    assert.strictEqual(second.manifest.stats.removedFiles, 1);
    assert.strictEqual(Object.keys(second.manifest.files).length, 1);
    assert.ok(fs.existsSync(path.join(indexDir, firstDocPaths[0])) || fs.existsSync(path.join(indexDir, firstDocPaths[1])));
    assert.ok(firstDocPaths.some((docPath) => !fs.existsSync(path.join(indexDir, docPath))));
  });

  it("summarizes rollout persistence modes independently of store orchestration", () => {
    const stats = buildRolloutPersistenceStats([
      {
        rolloutPersistence: {
          memoryMode: "disabled",
          eventMode: "extended",
          extendedObserved: true,
        },
      },
      {
        rolloutPersistence: {
          memoryMode: "disabled",
          eventMode: "limited",
          extendedObserved: false,
        },
      },
      {
        rolloutPersistence: {
          memoryMode: "enabled",
        },
      },
      {},
    ]);

    assert.deepStrictEqual(stats.memoryModeCounts, {
      disabled: 2,
      enabled: 1,
    });
    assert.deepStrictEqual(stats.eventModeCounts, {
      extended: 1,
      limited: 1,
      limited_or_unknown: 1,
    });
    assert.strictEqual(stats.extendedEventSessions, 1);
  });

  it("builds persistent session docs for legacy flat rollout json files", () => {
    writeLegacyRollout(sessionDir, "rollout-2025-04-28-08e89bd6-a21c-4356-aa02-ceeb5d84716d.json", {
      timestamp: "2025-04-28T16:19:19.416Z",
      id: "08e89bd6-a21c-4356-aa02-ceeb5d84716d",
      instructions: "legacy instructions",
    }, [
      {
        role: "user",
        content: [{ type: "text", text: "create a dockerfile" }],
      },
      {
        role: "assistant",
        content: "Use git to keep local and remote folders in sync.",
      },
    ]);

    const built = buildPersistentHistoryIndex({ sessionDir, indexRoot: indexDir });
    const session = built.catalog.sessions.find((entry) => entry.sessionId === "codex:08e89bd6-a21c-4356-aa02-ceeb5d84716d");

    assert.ok(session);
    assert.strictEqual(built.catalog.sessionCount, 1);
    assert.match(session.baseInstructionsPreview, /legacy instructions/);
    assert.ok(
      Object.values(built.manifest.files).some((entry) => /08e89bd6-a21c-4356-aa02-ceeb5d84716d/.test(entry.docPath))
    );
  });
});
