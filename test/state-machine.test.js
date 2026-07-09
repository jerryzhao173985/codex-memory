const { describe, it, afterEach, mock } = require("node:test");
const assert = require("node:assert");
const { CodexStateMachine } = require("../state-machine");

describe("CodexStateMachine", () => {
  afterEach(() => {
    mock.timers.reset();
  });

  it("defaults to idle with no sessions", () => {
    const machine = new CodexStateMachine();
    assert.strictEqual(machine.currentState, "idle");
    machine.stop();
  });

  it("keeps persistent session state underneath an attention oneshot", () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    const machine = new CodexStateMachine();

    machine.handleEvent({
      sessionId: "codex:s1",
      state: "working",
      event: "response_item:function_call",
      cwd: "/tmp"
    });
    assert.strictEqual(machine.currentState, "working");
    assert.strictEqual(machine.getSnapshot().sessions[0].state, "working");

    machine.handleEvent({
      sessionId: "codex:s1",
      state: "attention",
      event: "event_msg:task_complete",
      cwd: "/tmp"
    });
    assert.strictEqual(machine.currentState, "attention");
    assert.strictEqual(machine.getSnapshot().sessions[0].state, "working");

    mock.timers.tick(4000);
    assert.strictEqual(machine.currentState, "working");
    machine.stop();
  });

  it("normalizes codex-permission to notification and stores the command preview", () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    const machine = new CodexStateMachine();

    machine.handleEvent({
      sessionId: "codex:s1",
      state: "codex-permission",
      event: "response_item:function_call",
      cwd: "/repo",
      permissionDetail: { command: "git push" }
    });

    assert.strictEqual(machine.currentState, "notification");
    const session = machine.getSnapshot().sessions[0];
    assert.strictEqual(session.state, "idle");
    assert.strictEqual(session.permissionDetail.command, "git push");

    mock.timers.tick(2500);
    assert.strictEqual(machine.currentState, "idle");
    machine.stop();
  });

  it("removes sleeping sessions and resolves back to idle", () => {
    const machine = new CodexStateMachine();
    machine.handleEvent({
      sessionId: "codex:s1",
      state: "working",
      event: "response_item:function_call"
    });
    assert.strictEqual(machine.currentState, "working");

    machine.handleEvent({
      sessionId: "codex:s1",
      state: "sleeping",
      event: "stale-cleanup"
    });
    assert.strictEqual(machine.currentState, "idle");
    assert.strictEqual(machine.getSnapshot().sessionCount, 0);
    machine.stop();
  });

  it("stores richer metadata from observed records", () => {
    const machine = new CodexStateMachine();

    machine.observeRecord("codex:s1", {
      timestamp: "2026-04-09T16:02:10.601Z",
      key: "session_meta",
      kind: "session_meta",
      preview: "session meta",
      cwd: "/repo",
      sessionMeta: {
        cwd: "/repo",
        cliVersion: "0.117.0-alpha.22",
        agentNickname: "Turing",
      },
    }, {});

    machine.observeRecord("codex:s1", {
      timestamp: "2026-04-09T16:02:11.000Z",
      key: "event_msg:token_count",
      kind: "token_count",
      preview: "token count 1000",
      tokenUsage: { total: { total_tokens: 1000 }, last: { total_tokens: 100 }, modelContextWindow: 258400 },
      rateLimits: { limit_id: "codex" },
      cwd: "/repo",
    }, {});

    machine.observeRecord("codex:s1", {
      timestamp: "2026-04-09T16:02:12.000Z",
      key: "response_item:function_call",
      kind: "tool_call",
      preview: "git status",
      callId: "call_1",
      toolName: "exec_command",
      toolClass: "function",
      command: "git status",
      cwd: "/repo",
    }, {});

    machine.observeRecord("codex:s1", {
      timestamp: "2026-04-09T16:02:13.000Z",
      key: "response_item:function_call_output",
      kind: "tool_output",
      preview: "On branch main",
      callId: "call_1",
      output: {
        preview: "On branch main",
        text: "On branch main",
        exitCode: 0,
        durationSeconds: 0.05,
        tokenCount: 12,
        chunkId: "abc",
      },
      cwd: "/repo",
    }, {});

    machine.observeRecord("codex:s1", {
      timestamp: "2026-04-09T16:02:14.000Z",
      key: "response_item:web_search_call",
      kind: "web_search",
      preview: "site:github.com codex parser",
      query: "site:github.com codex parser",
      queries: ["site:github.com codex parser"],
      actionType: "search",
      toolStatus: "completed",
      cwd: "/repo",
    }, {});

    const session = machine.getSnapshot().sessions[0];
    assert.strictEqual(session.sessionMeta.cliVersion, "0.117.0-alpha.22");
    assert.strictEqual(session.lastTokenCount.total.total_tokens, 1000);
    assert.strictEqual(session.lastCommand.command, "git status");
    assert.strictEqual(session.lastCommand.exitCode, 0);
    assert.strictEqual(session.searchStats.total, 1);
    assert.strictEqual(session.analytics.intent, "researching");
    assert.strictEqual(session.analytics.tokens.windowTokens, 100);
    assert.match(session.analytics.focus, /command|search/);
    assert.ok(session.recentEvents.length >= 4);
    machine.stop();
  });

  it("deduplicates repeated observed records", () => {
    const machine = new CodexStateMachine();
    const record = {
      timestamp: "2026-04-09T16:02:14.000Z",
      key: "response_item:web_search_call",
      kind: "web_search",
      preview: "site:github.com codex parser",
      query: "site:github.com codex parser",
      queries: ["site:github.com codex parser"],
      actionType: "search",
      toolStatus: "completed",
      toolName: "web_search",
      cwd: "/repo",
    };

    machine.observeRecord("codex:s1", record, {});
    machine.observeRecord("codex:s1", record, {});

    const session = machine.getSnapshot().sessions[0];
    assert.strictEqual(session.searchStats.total, 1);
    assert.strictEqual(session.toolCallCount, 1);
    assert.strictEqual(session.recentEvents.length, 1);
    machine.stop();
  });

  it("prefers the latest activity over older errors for intent and focus", () => {
    const machine = new CodexStateMachine();

    machine.observeRecord("codex:s1", {
      timestamp: "2026-04-09T16:02:10.000Z",
      key: "event_msg:error",
      kind: "error",
      preview: "unexpected status 401",
      error: {
        message: "unexpected status 401",
        code: "other",
        statusCode: 401,
      },
    }, {});

    machine.observeRecord("codex:s1", {
      timestamp: "2026-04-09T16:02:11.000Z",
      key: "response_item:function_call",
      kind: "tool_call",
      preview: "git status",
      callId: "call_1",
      toolName: "exec_command",
      toolClass: "function",
      command: "git status",
    }, {});

    const session = machine.getSnapshot().sessions[0];
    assert.notStrictEqual(session.analytics.intent, "blocked");
    assert.match(session.analytics.focus, /git status/);
    machine.stop();
  });
});
