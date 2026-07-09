const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildSchemaProfile, createSchemaProfileStore } = require("../schema-profile");

function makeTempSessionDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-schema-profile-"));
  const dateDir = path.join(tmpDir, "2026", "04", "09");
  fs.mkdirSync(dateDir, { recursive: true });
  return { tmpDir, dateDir };
}

function writeRollout(dateDir, fileName, records) {
  fs.writeFileSync(path.join(dateDir, fileName), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

function writeLegacyRollout(sessionDir, fileName, session, items) {
  fs.writeFileSync(path.join(sessionDir, fileName), JSON.stringify({ session, items }, null, 2));
}

describe("schema profile", () => {
  let tmpDir;
  let dateDir;

  beforeEach(() => {
    ({ tmpDir, dateDir } = makeTempSessionDir());
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("profiles raw and normalized field coverage for rollout keys", () => {
    writeRollout(dateDir, "rollout-2026-04-09T15-10-51-019d23d4-f1a9-7633-b9c7-758327137228.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137228",
          cwd: "/repo/a",
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
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_1",
          turn_id: "turn-1",
          command: ["/bin/zsh", "-lc", "rg -n \"history layer\" src/history.js"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "search",
            cmd: "rg -n \"history layer\" src/history.js",
            query: "history layer",
            path: "src/history.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "1:history layer\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 241700000 },
          status: "completed",
        },
      },
    ]);

    const profile = buildSchemaProfile({ sessionDir: tmpDir, q: "exec_command_end", limit: 10 });
    assert.strictEqual(profile.recordCount, 3);
    assert.strictEqual(profile.totalMatchedKeys, 1);
    assert.strictEqual(profile.keys[0].key, "event_msg:exec_command_end");
    assert.ok(profile.keys[0].rawFields.some((field) => field.path === "payload.parsed_cmd[].query"));
    assert.ok(profile.keys[0].normalizedFields.some((field) => field.path === "command"));
    assert.ok(profile.keys[0].normalizedFields.some((field) => field.path === "commandPaths"));
    assert.ok(profile.keys[0].normalizedFields.some((field) => field.path === "commandQueries"));
    assert.ok(profile.keys[0].normalizedFields.some((field) => field.path === "output.exitCode"));
  });

  it("caches the full profile instead of reusing a previously filtered subset", () => {
    writeRollout(dateDir, "rollout-2026-04-09T15-10-51-019d23d4-f1a9-7633-b9c7-758327137228.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137228",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_1",
          turn_id: "turn-1",
          command: ["/bin/zsh", "-lc", "pwd"],
          cwd: "/repo/a",
          source: "unified_exec_startup",
          aggregated_output: "/repo/a\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 141700000 },
          status: "completed",
        },
      },
    ]);

    const store = createSchemaProfileStore({ sessionDir: tmpDir, refreshMs: 60000 });
    const filtered = store.getProfile({
      q: "exec_command_end",
      limit: 1,
      refresh: true,
    });
    assert.strictEqual(filtered.totalMatchedKeys, 1);
    assert.strictEqual(filtered.keys.length, 1);

    const full = store.getProfile({
      limit: 10,
      refresh: false,
    });
    assert.strictEqual(full.totalKeys, 2);
    assert.ok(full.keys.some((entry) => entry.key === "session_meta"));
    assert.ok(full.keys.some((entry) => entry.key === "event_msg:exec_command_end"));
  });

  it("profiles legacy flat rollout json files after normalizing them into rollout objects", () => {
    writeLegacyRollout(tmpDir, "rollout-2025-04-28-08e89bd6-a21c-4356-aa02-ceeb5d84716d.json", {
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
        content: "",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "shell",
              arguments: "{\"command\":[\"git\",\"status\"]}",
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        content: "{\"output\":\"On branch main\\n\",\"metadata\":{\"exit_code\":0}}",
      },
    ]);

    const profile = buildSchemaProfile({ sessionDir: tmpDir, limit: 10 });
    assert.ok(profile.keys.some((entry) => entry.key === "response_item:function_call"));
    assert.ok(profile.keys.some((entry) => entry.key === "response_item:function_call_output"));
    assert.ok(profile.keys.some((entry) => entry.key === "message"));
  });
});
