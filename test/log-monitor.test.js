const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const CodexLogMonitor = require("../log-monitor");
const codexConfig = require("../config");

function makeTempSessionDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "standalone-codex-"));
  const now = new Date();
  const dateDir = path.join(
    tmpDir,
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  );
  fs.mkdirSync(dateDir, { recursive: true });
  return { tmpDir, dateDir };
}

function makeConfig(tmpDir) {
  return {
    ...codexConfig,
    logConfig: { ...codexConfig.logConfig, sessionDir: tmpDir, pollIntervalMs: 50 }
  };
}

const TEST_FILENAME = "rollout-2026-03-25T15-10-51-019d23d4-f1a9-7633-b9c7-758327137228.jsonl";
const EXPECTED_SID = "codex:019d23d4-f1a9-7633-b9c7-758327137228";

describe("Standalone CodexLogMonitor", () => {
  let tmpDir;
  let dateDir;
  let monitor;

  beforeEach(() => {
    const dirs = makeTempSessionDir();
    tmpDir = dirs.tmpDir;
    dateDir = dirs.dateDir;
  });

  afterEach(() => {
    if (monitor) monitor.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts the session id from the rollout filename", (_, done) => {
    const testFile = path.join(dateDir, TEST_FILENAME);
    fs.writeFileSync(testFile, '{"type":"session_meta","payload":{"cwd":"/tmp"}}\n');

    monitor = new CodexLogMonitor(makeConfig(tmpDir), (sid, state) => {
      assert.strictEqual(sid, EXPECTED_SID);
      assert.strictEqual(state, "idle");
      done();
    });
    monitor.start();
  });

  it("watches flat root rollout jsonl files for older session layouts", (_, done) => {
    const testFile = path.join(tmpDir, TEST_FILENAME);
    fs.writeFileSync(testFile, '{"type":"session_meta","payload":{"cwd":"/tmp-flat"}}\n');

    monitor = new CodexLogMonitor(makeConfig(tmpDir), (sid, state) => {
      assert.strictEqual(sid, EXPECTED_SID);
      assert.strictEqual(state, "idle");
      done();
    });
    monitor.start();
  });

  it("resolves task_complete to attention only when tools were used", (_, done) => {
    const testFile = path.join(dateDir, TEST_FILENAME);
    fs.writeFileSync(testFile, [
      '{"type":"session_meta","payload":{"cwd":"/tmp"}}',
      '{"type":"event_msg","payload":{"type":"task_started"}}',
      '{"type":"response_item","payload":{"type":"function_call","name":"shell_command","arguments":"{\\"command\\":\\"ls\\"}"}}',
      '{"type":"event_msg","payload":{"type":"exec_command_end"}}',
      '{"type":"event_msg","payload":{"type":"task_complete"}}'
    ].join("\n") + "\n");

    const states = [];
    monitor = new CodexLogMonitor(makeConfig(tmpDir), (_sid, state) => {
      states.push(state);
      if (state === "attention") {
        assert.deepStrictEqual(states, ["idle", "thinking", "working", "attention"]);
        done();
      }
    });
    monitor.start();
  });

  it("deduplicates repeated working states", (_, done) => {
    const testFile = path.join(dateDir, TEST_FILENAME);
    fs.writeFileSync(testFile, [
      '{"type":"session_meta","payload":{"cwd":"/tmp"}}',
      '{"type":"response_item","payload":{"type":"function_call","name":"shell_command","arguments":"{\\"command\\":\\"ls\\"}"}}',
      '{"type":"response_item","payload":{"type":"function_call","name":"shell_command","arguments":"{\\"command\\":\\"pwd\\"}"}}'
    ].join("\n") + "\n");

    const states = [];
    monitor = new CodexLogMonitor(makeConfig(tmpDir), (_sid, state) => {
      states.push(state);
    });
    monitor.start();

    setTimeout(() => {
      assert.deepStrictEqual(states.slice(0, 2), ["idle", "working"]);
      done();
    }, 150);
  });

  it("emits codex-permission when a shell command stalls waiting for approval", (_, done) => {
    const testFile = path.join(dateDir, TEST_FILENAME);
    fs.writeFileSync(testFile, [
      '{"type":"session_meta","payload":{"cwd":"/projects/foo"}}',
      '{"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\\"cmd\\":\\"git push\\"}"}}'
    ].join("\n") + "\n");

    monitor = new CodexLogMonitor(
      makeConfig(tmpDir),
      (_sid, state, _event, extra) => {
        if (state === "codex-permission") {
          assert.strictEqual(extra.cwd, "/projects/foo");
          assert.strictEqual(extra.permissionDetail.command, "git push");
          done();
        }
      },
      { approvalHeuristicMs: 50 }
    );
    monitor.start();
  });

  it("cancels codex-permission when exec_command_end arrives quickly", (_, done) => {
    const testFile = path.join(dateDir, TEST_FILENAME);
    fs.writeFileSync(testFile, [
      '{"type":"session_meta","payload":{"cwd":"/tmp"}}',
      '{"type":"response_item","payload":{"type":"function_call","name":"shell_command","arguments":"{\\"command\\":\\"ls\\"}"}}',
      '{"type":"event_msg","payload":{"type":"exec_command_end"}}'
    ].join("\n") + "\n");

    const states = [];
    monitor = new CodexLogMonitor(
      makeConfig(tmpDir),
      (_sid, state) => states.push(state),
      { approvalHeuristicMs: 50 }
    );
    monitor.start();

    setTimeout(() => {
      assert.ok(!states.includes("codex-permission"));
      done();
    }, 150);
  });

  it("counts custom tool calls as tool use for task_complete resolution", (_, done) => {
    const testFile = path.join(dateDir, TEST_FILENAME);
    fs.writeFileSync(testFile, [
      '{"type":"session_meta","payload":{"cwd":"/tmp"}}',
      '{"type":"event_msg","payload":{"type":"task_started"}}',
      '{"type":"response_item","payload":{"type":"custom_tool_call","name":"apply_patch","status":"completed","call_id":"call_patch","input":"*** Begin Patch\\n*** Add File: /tmp/a.txt\\n+hello\\n*** End Patch"}}',
      '{"type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"call_patch","output":"{\\"output\\":\\"Success\\",\\"metadata\\":{\\"exit_code\\":0,\\"duration_seconds\\":0.1}}"}}',
      '{"type":"event_msg","payload":{"type":"task_complete"}}'
    ].join("\n") + "\n");

    const states = [];
    monitor = new CodexLogMonitor(makeConfig(tmpDir), (_sid, state) => {
      states.push(state);
      if (state === "attention") {
        assert.deepStrictEqual(states, ["idle", "thinking", "working", "attention"]);
        done();
      }
    });
    monitor.start();
  });

  it("emits normalized record events for token_count and turn_context", (_, done) => {
    const testFile = path.join(dateDir, TEST_FILENAME);
    fs.writeFileSync(testFile, [
      '{"type":"session_meta","payload":{"cwd":"/tmp"}}',
      '{"type":"turn_context","payload":{"turn_id":"turn-1","cwd":"/tmp","model":"gpt-5.4","approval_policy":"never","sandbox_policy":{"type":"workspace-write","network_access":true},"effort":"medium","summary":"auto"}}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":1000},"last_token_usage":{"total_tokens":100},"model_context_window":258400},"rate_limits":{"limit_id":"codex"}}}'
    ].join("\n") + "\n");

    const seen = [];
    monitor = new CodexLogMonitor(makeConfig(tmpDir), () => {});
    monitor.on("record", (_sid, record) => {
      seen.push(record.key);
      if (seen.includes("turn_context") && seen.includes("event_msg:token_count")) {
        done();
      }
    });
    monitor.start();
  });

  it("backfills recent existing rollout files on startup", (_, done) => {
    const testFile = path.join(dateDir, TEST_FILENAME);
    const recentTs = new Date(Date.now() - 60_000).toISOString();
    fs.writeFileSync(testFile, [
      JSON.stringify({ timestamp: recentTs, type: "session_meta", payload: { cwd: "/tmp" } }),
      JSON.stringify({
        timestamp: recentTs,
        type: "response_item",
        payload: { type: "function_call", name: "exec_command", arguments: "{\"cmd\":\"git status --short\"}" }
      })
    ].join("\n") + "\n");
    const older = new Date(Date.now() - 10_000);
    fs.utimesSync(testFile, older, older);

    const states = [];
    monitor = new CodexLogMonitor(
      makeConfig(tmpDir),
      (_sid, state) => states.push(state),
      { backfillRecentMs: 120_000, initialTailBytes: 16 * 1024 }
    );
    monitor.start();

    setTimeout(() => {
      assert.ok(states.includes("idle"));
      assert.ok(states.includes("working"));
      done();
    }, 150);
  });

  it("suppresses stale backfilled task_complete attention", (_, done) => {
    const testFile = path.join(dateDir, TEST_FILENAME);
    const recentTs = new Date(Date.now() - 60_000).toISOString();
    fs.writeFileSync(testFile, [
      JSON.stringify({ timestamp: recentTs, type: "session_meta", payload: { cwd: "/tmp" } }),
      JSON.stringify({ timestamp: recentTs, type: "event_msg", payload: { type: "task_started" } }),
      JSON.stringify({
        timestamp: recentTs,
        type: "response_item",
        payload: { type: "function_call", name: "exec_command", arguments: "{\"cmd\":\"git status --short\"}" }
      }),
      JSON.stringify({ timestamp: recentTs, type: "event_msg", payload: { type: "task_complete" } }),
    ].join("\n") + "\n");
    const older = new Date(Date.now() - 10_000);
    fs.utimesSync(testFile, older, older);

    const states = [];
    monitor = new CodexLogMonitor(
      makeConfig(tmpDir),
      (_sid, state) => states.push(state),
      { backfillRecentMs: 120_000, initialTailBytes: 16 * 1024 }
    );
    monitor.start();

    setTimeout(() => {
      assert.ok(!states.includes("attention"));
      done();
    }, 150);
  });
});
