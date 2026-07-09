const { describe, it } = require("node:test");
const assert = require("node:assert");

const parser = require("../parser");
const { createParserRecordNormalization } = require("../parser-record-normalization");
const codexConfig = require("../config");

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim();
}

function captureText(value, limit = 4000) {
  const text = cleanText(value);
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

function parseDurationMs(duration) {
  if (!duration || typeof duration !== "object") return null;
  const secs = Number(duration.secs || 0);
  const nanos = Number(duration.nanos || 0);
  if (!Number.isFinite(secs) || !Number.isFinite(nanos)) return null;
  return Math.round((secs * 1000) + (nanos / 1e6));
}

function createNormalization() {
  return createParserRecordNormalization({
    safeJsonParse: parser.safeJsonParse,
    summarizeText: parser.summarizeText,
    captureText,
    extractTextFromContent: parser.extractTextFromContent,
    extractReasoningSummary: parser.extractReasoningSummary,
    parseToolArguments: parser.parseToolArguments,
    parseDurationMs,
  });
}

describe("parser record normalization", () => {
  it("normalizes session metadata with rollout source and instruction previews", () => {
    const normalization = createNormalization();
    const record = normalization.normalizeRecordObject({
      timestamp: "2026-04-20T10:00:00.000Z",
      type: "session_meta",
      payload: {
        cwd: "/repo",
        model_provider: "openai",
        base_instructions: {
          text: "Be terse and focus on the requested change only.",
        },
        source: {
          subagent: {
            thread_spawn: {
              parent_thread_id: "019d-parent",
              depth: 1,
            },
          },
        },
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "session_meta");
    assert.strictEqual(record.cwd, "/repo");
    assert.strictEqual(record.sessionMeta.modelProvider, "openai");
    assert.strictEqual(record.sessionMeta.sourceKind, "subAgentThreadSpawn");
    assert.strictEqual(record.sessionMeta.sourceDetail.parentThreadId, "codex:019d-parent");
    assert.strictEqual(record.sessionMeta.subagent.parentThreadId, "019d-parent");
    assert.match(record.sessionMeta.baseInstructionsPreview, /Be terse/i);
  });

  it("normalizes exec_command records and summarizes them consistently", () => {
    const normalization = createNormalization();
    const record = normalization.normalizeRecordObject({
      timestamp: "2026-04-20T10:05:00.000Z",
      type: "event_msg",
      payload: {
        type: "exec_command_end",
        call_id: "call_exec",
        turn_id: "turn_exec",
        command: ["/bin/zsh", "-lc", "rg --glob '*.test.js' foo src"],
        parsed_cmd: [{
          type: "search",
          cmd: "rg --glob '*.test.js' foo src",
          query: "foo",
          path: "src",
        }],
        aggregated_output: "src/app.test.js:1:test\n",
        exit_code: 0,
        duration: { secs: 1, nanos: 250000000 },
        status: "completed",
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "tool_output");
    assert.strictEqual(record.command, "rg --glob '*.test.js' foo src");
    assert.deepStrictEqual(record.commandTypes, ["search"]);
    assert.deepStrictEqual(record.commandPaths, ["src"]);
    assert.deepStrictEqual(record.commandPathPatterns, ["*.test.js"]);
    assert.deepStrictEqual(record.commandQueries, ["foo"]);
    assert.deepStrictEqual(record.shellCommands, ["rg"]);

    const summary = normalization.summarizeRecord(record);
    assert.strictEqual(summary.activityCategory, "search");
    assert.deepStrictEqual(summary.commandTypes, ["search"]);
    assert.deepStrictEqual(summary.commandPathPatterns, ["*.test.js"]);
    assert.deepStrictEqual(summary.commandQueries, ["foo"]);
    assert.strictEqual(summary.exitCode, 0);
  });
});

describe("parser record normalization for newer event shapes", () => {
  it("normalizes dynamic tool call requests with camelCase ids and path args", () => {
    const normalization = createNormalization();
    const record = normalization.normalizeRecordObject({
      timestamp: "2026-04-23T11:11:45.880Z",
      type: "event_msg",
      payload: {
        type: "dynamic_tool_call_request",
        callId: "call_dyn_1",
        turnId: "turn_dyn_1",
        tool: "Read",
        arguments: { file_path: "/repo/docs/README.md" },
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "tool_call");
    assert.strictEqual(record.toolClass, "dynamic");
    assert.strictEqual(record.toolName, "Read");
    assert.strictEqual(record.callId, "call_dyn_1");
    assert.strictEqual(record.turnId, "turn_dyn_1");
    assert.deepStrictEqual(record.commandPaths, ["/repo/docs/README.md"]);
  });

  it("normalizes dynamic Bash requests with command inference", () => {
    const normalization = createNormalization();
    const record = normalization.normalizeRecordObject({
      timestamp: "2026-04-23T11:12:00.000Z",
      type: "event_msg",
      payload: {
        type: "dynamic_tool_call_request",
        call_id: "call_dyn_2",
        turn_id: "turn_dyn_2",
        tool: "Bash",
        arguments: { command: "rg foo src" },
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "tool_call");
    assert.strictEqual(record.command, "rg foo src");
    assert.deepStrictEqual(record.shellCommands, ["rg"]);
  });

  it("normalizes dynamic tool call responses with content items and duration", () => {
    const normalization = createNormalization();
    const record = normalization.normalizeRecordObject({
      timestamp: "2026-04-23T11:11:45.906Z",
      type: "event_msg",
      payload: {
        type: "dynamic_tool_call_response",
        call_id: "call_dyn_1",
        turn_id: "turn_dyn_1",
        tool: "Read",
        content_items: [{ type: "inputText", text: "1\t# Docs" }],
        success: true,
        error: null,
        duration: { secs: 0, nanos: 26135000 },
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "tool_output");
    assert.strictEqual(record.toolClass, "dynamic");
    assert.strictEqual(record.success, true);
    assert.strictEqual(record.output.text, "1\t# Docs");
    assert.ok(record.output.durationSeconds > 0);
    assert.strictEqual(record.stateSignal, "working");
  });

  it("normalizes collab agent spawn events with thread lineage fields", () => {
    const normalization = createNormalization();
    const record = normalization.normalizeRecordObject({
      timestamp: "2026-04-11T00:43:25.000Z",
      type: "event_msg",
      payload: {
        type: "collab_agent_spawn_end",
        call_id: "call_spawn",
        sender_thread_id: "019d-sender",
        new_thread_id: "019d-child",
        new_agent_nickname: "Herschel",
        new_agent_role: "explorer",
        prompt: "Explore the repository structure.",
        model: "gpt-5.4-mini",
        status: "pending_init",
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "collab");
    assert.strictEqual(record.collab.senderThreadId, "019d-sender");
    assert.strictEqual(record.collab.spawnedThreadId, "019d-child");
    assert.strictEqual(record.collab.agentNickname, "Herschel");
    assert.strictEqual(record.collab.agentRole, "explorer");
    assert.match(record.preview, /Herschel/);
  });

  it("normalizes guardian assessments with the assessed command", () => {
    const normalization = createNormalization();
    const record = normalization.normalizeRecordObject({
      timestamp: "2026-05-01T10:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "guardian_assessment",
        id: "assessment-1",
        target_item_id: "call_target",
        turn_id: "turn_g",
        status: "in_progress",
        action: {
          type: "command",
          source: "unified_exec",
          command: "rm -rf samples",
          cwd: "/repo",
        },
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "guardian");
    assert.strictEqual(record.guardian.status, "in_progress");
    assert.strictEqual(record.command, "rm -rf samples");
    assert.strictEqual(record.cwd, "/repo");
  });

  it("normalizes thread name updates as thread metadata", () => {
    const normalization = createNormalization();
    const record = normalization.normalizeRecordObject({
      timestamp: "2026-06-01T10:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "thread_name_updated",
        thread_id: "019d-thread",
        thread_name: "Investigate locomotion stall",
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "thread_meta");
    assert.strictEqual(record.threadMeta.threadId, "019d-thread");
    assert.strictEqual(record.threadMeta.threadName, "Investigate locomotion stall");
  });

  it("treats turn_started and turn_complete as lifecycle aliases", () => {
    const normalization = createNormalization();
    const started = normalization.normalizeRecordObject({
      timestamp: "2026-06-01T10:00:00.000Z",
      type: "event_msg",
      payload: { type: "turn_started", turn_id: "turn-1" },
    }, { logEventMap: codexConfig.logEventMap });
    const completed = normalization.normalizeRecordObject({
      timestamp: "2026-06-01T10:01:00.000Z",
      type: "event_msg",
      payload: { type: "turn_complete", turn_id: "turn-1", last_agent_message: "Done." },
    }, { logEventMap: codexConfig.logEventMap });
    const legacyStarted = normalization.normalizeRecordObject({
      timestamp: "2026-06-01T10:02:00.000Z",
      type: "event_msg",
      payload: { type: "task_started", turn_id: "turn-2" },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(started.kind, "turn_lifecycle");
    assert.strictEqual(started.lifecycle, "started");
    assert.strictEqual(started.stateSignal, "thinking");
    assert.strictEqual(completed.lifecycle, "completed");
    assert.strictEqual(completed.text, "Done.");
    assert.strictEqual(completed.stateSignal, "codex-turn-end");
    assert.strictEqual(legacyStarted.lifecycle, "started");
  });

  it("normalizes bare mid-generation response items without payload envelopes", () => {
    const normalization = createNormalization();
    const reasoning = normalization.normalizeRecordObject({
      timestamp: "2025-09-09T13:23:03.731Z",
      type: "reasoning",
      summary: [{ type: "summary_text", text: "Determining approach" }],
    }, { logEventMap: codexConfig.logEventMap });
    const call = normalization.normalizeRecordObject({
      type: "function_call",
      name: "shell",
      arguments: "{\"command\":[\"bash\",\"-lc\",\"pwd\"]}",
      call_id: "call-mid-1",
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(reasoning.kind, "reasoning");
    assert.match(reasoning.text, /Determining approach/);
    assert.strictEqual(call.kind, "tool_call");
    assert.strictEqual(call.callId, "call-mid-1");
    assert.strictEqual(call.command, "pwd");
  });

  it("upgrades bare mid-generation session headers to session_meta with git info", () => {
    const normalization = createNormalization();
    const record = normalization.normalizeRecordObject({
      id: "e58d935c-7bc1-49b3-beb4-cbbeaac598ce",
      timestamp: "2025-09-09T13:23:03.731Z",
      instructions: null,
      git: {
        commit_hash: "b36aa947dbfe74c136867ad7633c3f64fcf47e18",
        branch: "ex2",
        repository_url: "https://github.com/example/mlir-list.git",
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "session_meta");
    assert.strictEqual(record.sessionMeta.id, "e58d935c-7bc1-49b3-beb4-cbbeaac598ce");
    assert.strictEqual(record.sessionMeta.git.branch, "ex2");
    assert.strictEqual(record.sessionMeta.git.sha, "b36aa947dbfe74c136867ad7633c3f64fcf47e18");
  });

  it("marks record_type-only lines as state markers instead of session headers", () => {
    const normalization = createNormalization();
    const record = normalization.normalizeRecordObject(
      { record_type: "state" },
      { logEventMap: codexConfig.logEventMap }
    );

    assert.strictEqual(record.kind, "state_marker");
  });

  it("normalizes world_state items with environment cwds", () => {
    const normalization = createNormalization();
    const record = normalization.normalizeRecordObject({
      timestamp: "2026-07-09T20:37:56.207Z",
      type: "world_state",
      payload: {
        full: true,
        state: {
          environments: {
            environments: {
              local: { cwd: "/repo/worktree", status: "available", shell: "zsh" },
            },
            current_date: "2026-07-09",
            timezone: "Europe/London",
          },
        },
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "world_state");
    assert.strictEqual(record.worldState.full, true);
    assert.deepStrictEqual(record.worldState.environmentCwds, ["/repo/worktree"]);
    assert.strictEqual(record.cwd, "/repo/worktree");
  });

  it("normalizes tool_search calls with their query", () => {
    const normalization = createNormalization();
    const record = normalization.normalizeRecordObject({
      timestamp: "2026-06-16T06:25:46.313Z",
      type: "response_item",
      payload: {
        type: "tool_search_call",
        call_id: "call_ts",
        status: "completed",
        execution: "client",
        arguments: { query: "GitHub pull request read", limit: 8 },
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "tool_call");
    assert.strictEqual(record.toolName, "tool_search");
    assert.strictEqual(record.query, "GitHub pull request read");
  });

  it("normalizes view_image tool calls with the image path", () => {
    const normalization = createNormalization();
    const record = normalization.normalizeRecordObject({
      timestamp: "2026-06-01T10:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "view_image_tool_call",
        call_id: "call_img",
        path: "/tmp/page-1.png",
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "tool_call");
    assert.strictEqual(record.toolName, "view_image");
    assert.deepStrictEqual(record.commandPaths, ["/tmp/page-1.png"]);
  });
});
