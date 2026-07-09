const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { CodexStateMachine } = require("../state-machine");
const { createCodexServer } = require("../server");
const { createHistoryStore } = require("../history-store");

function requestJson({ method, port, pathname, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method,
        headers: payload
          ? {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload)
          }
          : {}
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            body: raw ? JSON.parse(raw) : null
          });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

describe("createCodexServer", { concurrency: false }, () => {
  it("accepts POST /state and exposes the aggregate snapshot", async () => {
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-server-"));
    const runtimePath = path.join(runtimeDir, "runtime.json");
    const machine = new CodexStateMachine();
    const server = createCodexServer({
      stateMachine: machine,
      preferredPort: 24736,
      runtimeConfigPath: runtimePath
    });

    try {
      await server.start();
      const port = server.getPort();

      const post = await requestJson({
        method: "POST",
        port,
        pathname: "/state",
        body: {
          state: "working",
          session_id: "codex:s1",
          event: "response_item:function_call",
          cwd: "/repo"
        }
      });
      assert.strictEqual(post.statusCode, 200);
      assert.strictEqual(post.body.snapshot.state, "working");

      const get = await requestJson({
        method: "GET",
        port,
        pathname: "/state"
      });
      assert.strictEqual(get.statusCode, 200);
      assert.strictEqual(get.body.state, "working");
      assert.strictEqual(get.body.sessions[0].cwd, "/repo");

      const events = await requestJson({
        method: "GET",
        port,
        pathname: "/events"
      });
      assert.strictEqual(events.statusCode, 200);
      assert.ok(events.body.events.length >= 0);

      const analytics = await requestJson({
        method: "GET",
        port,
        pathname: "/analytics"
      });
      assert.strictEqual(analytics.statusCode, 200);
      assert.strictEqual(analytics.body.sessionCount, 1);
      assert.strictEqual(analytics.body.state, "working");
    } finally {
      await server.stop();
      machine.stop();
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }
  });

  it("accepts record-only POST /state updates", async () => {
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-server-"));
    const runtimePath = path.join(runtimeDir, "runtime.json");
    const machine = new CodexStateMachine();
    const server = createCodexServer({
      stateMachine: machine,
      preferredPort: 24737,
      runtimeConfigPath: runtimePath
    });

    try {
      await server.start();
      const port = server.getPort();

      const post = await requestJson({
        method: "POST",
        port,
        pathname: "/state",
        body: {
          session_id: "codex:s1",
          cwd: "/repo",
          record: {
            timestamp: "2026-04-09T16:02:11.405Z",
            key: "event_msg:token_count",
            kind: "token_count",
            preview: "token count 1000",
            tokenUsage: { total: { total_tokens: 1000 }, last: null, modelContextWindow: 258400 },
            rateLimits: { limit_id: "codex" }
          }
        }
      });
      assert.strictEqual(post.statusCode, 200);
      assert.strictEqual(post.body.snapshot.sessions[0].lastTokenCount.total.total_tokens, 1000);
    } finally {
      await server.stop();
      machine.stop();
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }
  });

  it("forwards structured resume filters to the catalog store", async () => {
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-server-"));
    const runtimePath = path.join(runtimeDir, "runtime.json");
    const machine = new CodexStateMachine();
    let captured = null;
    const server = createCodexServer({
      stateMachine: machine,
      preferredPort: 24739,
      runtimeConfigPath: runtimePath,
      catalogStore: {
        getResume() {
          return null;
        },
        async getResumeResolved(sessionId, filters) {
          captured = { sessionId, filters };
          return {
            session: { sessionId, cwd: "/repo", updatedAt: null, startedAt: null, model: null },
            source: { requested: filters.source || "auto", used: "rollout", bridgeError: null },
            historyMode: filters.historyMode || "effective",
            shaping: {
              toolTextMode: filters.toolText || "salient",
              trimStrategy: filters.trimStrategy || "middle",
              totalChars: filters.budgetChars || 12000,
              itemChars: filters.itemChars || 600,
              toolChars: filters.toolChars || 280,
              lineLimit: filters.lineLimit || 10,
            },
            compactions: { count: 0, lastTimestamp: null, lastPreview: "" },
            quality: { mode: "derived_extended_rollout" },
            reloadSafety: { allowed: true, decision: "ready" },
            turnCount: 0,
            totalTurnCount: 0,
            turnsTruncated: false,
            turns: [],
            highlights: { queries: [], pathHighlights: [], filesTouched: [], pathsReferenced: [], pathsWritten: [], pathsRead: [], searchScopes: [], listScopes: [], errors: [], commands: [], tools: [] },
            overview: { latestTurnId: null, latestStatus: null, latestUserText: "", latestAnswerText: "", latestCommentaryText: "" },
            text: "",
            truncated: false,
            remainingChars: 0,
          };
        }
      }
    });

    try {
      await server.start();
      const port = server.getPort();
      const resume = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/resume?session_id=codex:test&q=hello&query=AGENTS.md&query_mode=fuzzy&tool=exec_command&file=codex%2FREADME.md&path=codex%2Fcatalog.js&path_pattern=*.md&path_role=read&command_op=sed&command_op_signal=high&command_type=read&quality_class=useful_limited&error=ENOENT&turn=turn-1&status=completed&bookmarked=1&manual_tag=important&source=auto"
      });
      assert.strictEqual(resume.statusCode, 200);
      assert.ok(captured);
      assert.strictEqual(captured.sessionId, "codex:test");
      assert.strictEqual(captured.filters.q, "hello");
      assert.strictEqual(captured.filters.query, "AGENTS.md");
      assert.strictEqual(captured.filters.queryMode, "fuzzy");
      assert.strictEqual(captured.filters.tool, "exec_command");
      assert.strictEqual(captured.filters.file, "codex/README.md");
      assert.strictEqual(captured.filters.path, "codex/catalog.js");
      assert.strictEqual(captured.filters.pathPattern, "*.md");
      assert.strictEqual(captured.filters.pathRole, "read");
      assert.strictEqual(captured.filters.commandOp, "sed");
      assert.strictEqual(captured.filters.commandOpSignal, "high");
      assert.strictEqual(captured.filters.commandType, "read");
      assert.strictEqual(captured.filters.qualityClass, "useful_limited");
      assert.strictEqual(captured.filters.error, "ENOENT");
      assert.strictEqual(captured.filters.turn, "turn-1");
      assert.strictEqual(captured.filters.status, "completed");
      assert.strictEqual(captured.filters.bookmarked, "1");
      assert.deepStrictEqual(captured.filters.manualTags, ["important"]);
    } finally {
      await server.stop();
      machine.stop();
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }
  });

  it("exposes historical catalog endpoints", async () => {
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-server-"));
    const runtimePath = path.join(runtimeDir, "runtime.json");
    const sessionDir = path.join(runtimeDir, "sessions", "2026", "04", "09");
    const indexDir = path.join(runtimeDir, "index");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(
      sessionDir,
      "rollout-2026-04-09T15-10-51-019d23d4-f1a9-7633-b9c7-758327137228.jsonl"
    ), [
      JSON.stringify({
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "019d23d4-f1a9-7633-b9c7-758327137228", cwd: "/repo/a", memory_mode: "disabled" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-1", cwd: "/repo/a", model: "gpt-5.4" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "find feature toggle" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T15:10:53.500Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_1",
          arguments: "{\"cmd\":\"git status --short\",\"workdir\":\"/repo/a\"}",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T15:10:53.650Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_2",
          arguments: "{\"cmd\":\"sed -n '1,120p' src/history.js\",\"workdir\":\"/repo/a\"}",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T15:10:53.700Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_2",
          turn_id: "turn-1",
          command: ["/bin/zsh", "-lc", "sed -n '1,120p' src/history.js"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "read",
            cmd: "sed -n '1,120p' src/history.js",
            name: "history.js",
            path: "src/history.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "history layer\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 341700000 },
          status: "completed",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T15:10:53.800Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_3",
          arguments: "{\"cmd\":\"rg --glob src/**/*.test.js feature-toggle\",\"workdir\":\"/repo/a\"}",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T15:10:53.850Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_3",
          turn_id: "turn-1",
          command: ["/bin/zsh", "-lc", "rg --glob src/**/*.test.js feature-toggle"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "search",
            cmd: "rg --glob src/**/*.test.js feature-toggle",
            query: "feature-toggle",
            path: "src/**/*.test.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "",
          exit_code: 0,
          duration: { secs: 0, nanos: 91700000 },
          status: "completed",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-1", last_agent_message: "done" },
      }),
    ].join("\n") + "\n");
    fs.writeFileSync(path.join(
      sessionDir,
      "rollout-2026-04-09T16-10-51-019d23d4-f1a9-7633-b9c7-758327137229.jsonl"
    ), [
      JSON.stringify({
        timestamp: "2026-04-09T16:10:51.000Z",
        type: "session_meta",
        payload: { id: "019d23d4-f1a9-7633-b9c7-758327137229", cwd: "/repo/a" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T16:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-2", cwd: "/repo/a", model: "gpt-5.4" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T16:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_related",
          turn_id: "turn-2",
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
          duration: { secs: 0, nanos: 141700000 },
          status: "completed",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T16:10:54.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-2", last_agent_message: "confirmed history layer" },
      }),
    ].join("\n") + "\n");
    fs.writeFileSync(path.join(
      sessionDir,
      "rollout-2026-04-09T17-10-51-019d23d4-f1a9-7633-b9c7-758327137230.jsonl"
    ), [
      JSON.stringify({
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: { id: "019d23d4-f1a9-7633-b9c7-758327137230", cwd: "/repo/c" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-keep", cwd: "/repo/c", model: "gpt-5.4" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "keep this turn" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T17:10:54.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-keep", last_agent_message: "kept answer" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T17:10:55.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-drop", cwd: "/repo/c", model: "gpt-5.4" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T17:10:56.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "drop this turn" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T17:10:57.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call_drop_patch",
          turn_id: "turn-drop",
          success: true,
          changes: {
            "/repo/c/src/drop.js": { type: "update" },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T17:10:57.500Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-drop", last_agent_message: "dropped answer" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T17:10:58.000Z",
        type: "event_msg",
        payload: { type: "thread_rolled_back", num_turns: 1 },
      }),
    ].join("\n") + "\n");
    fs.writeFileSync(path.join(
      sessionDir,
      "rollout-2026-04-09T18-10-51-019d23d4-f1a9-7633-b9c7-758327137231.jsonl"
    ), [
      JSON.stringify({
        timestamp: "2026-04-09T18:10:51.000Z",
        type: "session_meta",
        payload: { id: "019d23d4-f1a9-7633-b9c7-758327137231", cwd: "/repo/a" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T18:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-docs", cwd: "/repo/a", model: "gpt-5.4" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T18:10:53.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "refresh the docs overview" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T18:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call_docs_patch",
          turn_id: "turn-docs",
          success: true,
          changes: {
            "/repo/a/docs/guide.md": { type: "update" },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T18:10:55.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-docs", last_agent_message: "Updated the docs guide" },
      }),
    ].join("\n") + "\n");
    fs.writeFileSync(path.join(
      sessionDir,
      "rollout-2026-04-09T19-10-51-019d23d4-f1a9-7633-b9c7-758327137232.jsonl"
    ), [
      JSON.stringify({
        timestamp: "2026-04-09T19:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137232",
          cwd: "/repo/a/nested",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T19:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-nested",
          cwd: "/repo/a/nested",
          model: "gpt-5.4",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T19:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call_nested_patch",
          turn_id: "turn-nested",
          success: true,
          changes: {
            "/repo/a/nested/child/notes.md": { type: "update" },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T19:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-nested",
          last_agent_message: "Updated nested notes",
        },
      }),
    ].join("\n") + "\n");

    let bridgeThreadName = null;
    let bridgeThreadMemoryMode = null;
    let lastBridgeListParams = null;
    let bridgeGitInfo = {
      sha: "abc123",
      branch: "main",
      originUrl: "https://example.test/repo.git",
    };
    function makeBridgeThread() {
      return {
        id: "019d23d4-f1a9-7633-b9c7-758327137228",
        forkedFromId: null,
        preview: "I need a bridge-backed exact view for this session.",
        ephemeral: false,
        modelProvider: "openai",
        createdAt: 1775747451,
        updatedAt: 1775747455,
        status: { type: "notLoaded" },
        path: "/tmp/rollout-019d23d4-f1a9-7633-b9c7-758327137228.jsonl",
        cwd: "/repo/a",
        cliVersion: "0.119.0-alpha.5",
        source: "cli",
        agentNickname: null,
        agentRole: null,
        gitInfo: bridgeGitInfo,
        name: bridgeThreadName,
        turns: [
          {
            id: "turn-bridge",
            status: "completed",
            error: null,
            startedAt: 1775747452,
            completedAt: 1775747455,
            items: [
              { type: "userMessage", id: "item-1", content: [{ type: "text", text: "inspect bridge thread", text_elements: [] }] },
              { type: "agentMessage", id: "item-2", text: "bridge exact answer", phase: "final_answer", memoryCitation: null },
            ],
          },
        ],
      };
    }

    const catalogStore = createHistoryStore({
      sessionDir,
      indexRoot: indexDir,
      refreshMs: 0,
      appServer: {
        async listThreads(params = {}) {
          lastBridgeListParams = { ...params };
          return { data: [makeBridgeThread()], nextCursor: "next-bridge" };
        },
        async listLoadedThreads() {
          return { data: ["019d23d4-f1a9-7633-b9c7-758327137228"], nextCursor: null };
        },
        async readThread() {
          return { thread: makeBridgeThread() };
        },
        async setThreadName(_sessionId, name) {
          bridgeThreadName = name;
          return { thread: makeBridgeThread() };
        },
        async updateThreadMetadata(_sessionId, patch = {}) {
          const currentGitInfo = bridgeGitInfo || {};
          bridgeGitInfo = {
            branch: Object.prototype.hasOwnProperty.call(patch.gitInfo || {}, "branch")
              ? patch.gitInfo.branch
              : (currentGitInfo.branch ?? null),
            sha: Object.prototype.hasOwnProperty.call(patch.gitInfo || {}, "sha")
              ? patch.gitInfo.sha
              : (currentGitInfo.sha ?? null),
            originUrl: Object.prototype.hasOwnProperty.call(patch.gitInfo || {}, "originUrl")
              ? patch.gitInfo.originUrl
              : (currentGitInfo.originUrl ?? null),
          };
          return { thread: makeBridgeThread() };
        },
        async setThreadMemoryMode(sessionId, mode) {
          bridgeThreadMemoryMode = mode;
          return {
            threadId: "019d23d4-f1a9-7633-b9c7-758327137228",
            sessionId,
            memoryMode: mode,
          };
        },
        async archiveThread(sessionId) {
          return { threadId: "019d23d4-f1a9-7633-b9c7-758327137228", sessionId, archived: true };
        },
        async unarchiveThread() {
          return { thread: makeBridgeThread() };
        },
        close() {},
      },
    });

    const machine = new CodexStateMachine();
    const server = createCodexServer({
      stateMachine: machine,
      catalogStore,
      preferredPort: 24735,
      runtimeConfigPath: runtimePath
    });

    try {
      await server.start();
      const port = server.getPort();

      const catalog = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?q=feature%20toggle"
      });
      assert.strictEqual(catalog.statusCode, 200);
      assert.strictEqual(catalog.body.total, 1);
      assert.strictEqual(catalog.body.sessions[0].cwd, "/repo/a");

      const filteredCatalog = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?memory_mode=disabled"
      });
      assert.strictEqual(filteredCatalog.statusCode, 200);
      assert.strictEqual(filteredCatalog.body.total, 1);
      assert.strictEqual(filteredCatalog.body.sessions[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137228");

      const qualityCatalog = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?quality_class=rich_extended"
      });
      assert.strictEqual(qualityCatalog.statusCode, 200);
      assert.ok(qualityCatalog.body.total >= 1);
      assert.ok(qualityCatalog.body.sessions.some((session) => session.sessionId === "codex:019d23d4-f1a9-7633-b9c7-758327137228"));
      assert.ok(qualityCatalog.body.sessions.every((session) => session.qualityClass === "rich_extended"));

      const sessionIdCatalog = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228"
      });
      assert.strictEqual(sessionIdCatalog.statusCode, 200);
      assert.strictEqual(sessionIdCatalog.body.total, 1);
      assert.strictEqual(sessionIdCatalog.body.sessions[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137228");

      const compactCatalog = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?q=feature%20toggle&shape=compact"
      });
      assert.strictEqual(compactCatalog.statusCode, 200);
      assert.strictEqual(compactCatalog.body.shape, "compact");
      assert.strictEqual(compactCatalog.body.total, 1);
      assert.strictEqual(compactCatalog.body.facets, undefined);
      assert.strictEqual(compactCatalog.body.sessions[0].recentCommands, undefined);
      assert.strictEqual(compactCatalog.body.sessions[0].artifactSamples, undefined);

      const firstCatalogPage = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?limit=1"
      });
      assert.strictEqual(firstCatalogPage.statusCode, 200);

      const pagedCatalog = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?limit=1&offset=1"
      });
      assert.strictEqual(pagedCatalog.statusCode, 200);
      assert.strictEqual(pagedCatalog.body.offset, 1);
      assert.strictEqual(pagedCatalog.body.total, firstCatalogPage.body.total);
      assert.strictEqual(pagedCatalog.body.sessions.length, 1);
      assert.notStrictEqual(pagedCatalog.body.sessions[0].sessionId, firstCatalogPage.body.sessions[0].sessionId);

      const invalidCatalogLimit = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?limit=0"
      });
      assert.strictEqual(invalidCatalogLimit.statusCode, 400);
      assert.match(invalidCatalogLimit.body.error, /limit must be a positive integer/i);

      const invalidCatalogOffset = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?offset=-1"
      });
      assert.strictEqual(invalidCatalogOffset.statusCode, 400);
      assert.match(invalidCatalogOffset.body.error, /offset must be a non-negative integer/i);

      const queryCatalog = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?query=feature-toggle"
      });
      assert.strictEqual(queryCatalog.statusCode, 200);
      assert.strictEqual(queryCatalog.body.total, 1);
      assert.deepStrictEqual(queryCatalog.body.sessions[0].matchedQueries, ["feature-toggle"]);
      assert.deepStrictEqual(queryCatalog.body.sessions[0].match, {
        kind: "query",
        text: "feature-toggle",
        signalTier: "medium",
      });

      const fuzzyQueryCatalog = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?query=featre-toggle&query_mode=fuzzy"
      });
      assert.strictEqual(fuzzyQueryCatalog.statusCode, 200);
      assert.strictEqual(fuzzyQueryCatalog.body.queryMode, "fuzzy");
      assert.strictEqual(fuzzyQueryCatalog.body.total, 1);
      assert.deepStrictEqual(fuzzyQueryCatalog.body.querySignalSummary, {
        onlyLowSignal: false,
        examples: [],
      });
      assert.deepStrictEqual(fuzzyQueryCatalog.body.sessions[0].match, {
        kind: "query",
        text: "feature-toggle",
        signalTier: "medium",
      });

      const fuzzyProjectListByQuery = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/projects?query=featre-toggle&query_mode=fuzzy"
      });
      assert.strictEqual(fuzzyProjectListByQuery.statusCode, 200);
      assert.strictEqual(fuzzyProjectListByQuery.body.queryMode, "fuzzy");
      assert.strictEqual(fuzzyProjectListByQuery.body.total, 1);
      assert.strictEqual(fuzzyProjectListByQuery.body.projects[0].cwd, "/repo/a");

      const fuzzyCatalog = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?q=feture%20toggle&q_mode=fuzzy"
      });
      assert.strictEqual(fuzzyCatalog.statusCode, 200);
      assert.strictEqual(fuzzyCatalog.body.qMode, "fuzzy");
      assert.strictEqual(fuzzyCatalog.body.total, 1);
      assert.deepStrictEqual(fuzzyCatalog.body.sessions[0].match, {
        kind: "query",
        text: "feature-toggle",
        signalTier: "medium",
      });

      const turnSearch = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/turn-search?q=git%20status&cwd=%2Frepo%2Fa"
      });
      assert.strictEqual(turnSearch.statusCode, 200);
      assert.strictEqual(turnSearch.body.total, 1);
      assert.strictEqual(turnSearch.body.sessionCount, 1);
      assert.strictEqual(turnSearch.body.turns[0].turnId, "turn-1");

      const fuzzyTurnSearch = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/turn-search?query=featre-toggle&query_mode=fuzzy"
      });
      assert.strictEqual(fuzzyTurnSearch.statusCode, 200);
      assert.strictEqual(fuzzyTurnSearch.body.queryMode, "fuzzy");
      assert.strictEqual(fuzzyTurnSearch.body.total, 1);
      assert.deepStrictEqual(fuzzyTurnSearch.body.turns[0].matchedQueries, ["feature-toggle"]);

      const compactTurnSearch = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/turn-search?q=git%20status&cwd=%2Frepo%2Fa&shape=compact"
      });
      assert.strictEqual(compactTurnSearch.statusCode, 200);
      assert.strictEqual(compactTurnSearch.body.shape, "compact");
      assert.strictEqual(compactTurnSearch.body.total, 1);
      assert.strictEqual(compactTurnSearch.body.turns[0].queries, undefined);
      assert.strictEqual(compactTurnSearch.body.turns[0].pathsReferenced, undefined);
      assert.strictEqual(compactTurnSearch.body.turns[0].counts.errors, 0);

      const firstTurnPage = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/turn-search?limit=1"
      });
      assert.strictEqual(firstTurnPage.statusCode, 200);

      const pagedTurnSearch = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/turn-search?limit=1&offset=1"
      });
      assert.strictEqual(pagedTurnSearch.statusCode, 200);
      assert.strictEqual(pagedTurnSearch.body.offset, 1);
      assert.strictEqual(pagedTurnSearch.body.total, firstTurnPage.body.total);
      assert.strictEqual(pagedTurnSearch.body.turns.length, 1);
      assert.notStrictEqual(pagedTurnSearch.body.turns[0].turnId, firstTurnPage.body.turns[0].turnId);

      const turnSearchByPath = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/turn-search?path=history.js&command_type=read&cwd=%2Frepo%2Fa"
      });
      assert.strictEqual(turnSearchByPath.statusCode, 200);
      assert.strictEqual(turnSearchByPath.body.total, 1);
      assert.ok(turnSearchByPath.body.turns[0].commandTypes.includes("read"));
      assert.ok(turnSearchByPath.body.turns[0].pathsReferenced.includes("/repo/a/src/history.js"));
      assert.deepStrictEqual(turnSearchByPath.body.turns[0].matchedPaths, ["/repo/a/src/history.js"]);
      assert.ok(turnSearchByPath.body.turns[0].pathRoles.read.includes("/repo/a/src/history.js"));

      const turnSearchByPathRole = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/turn-search?path=history.js&path_role=read&cwd=%2Frepo%2Fa"
      });
      assert.strictEqual(turnSearchByPathRole.statusCode, 200);
      assert.strictEqual(turnSearchByPathRole.body.total, 1);

      const turnSearchByWrongPathRole = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/turn-search?path=history.js&path_role=write&cwd=%2Frepo%2Fa"
      });
      assert.strictEqual(turnSearchByWrongPathRole.statusCode, 200);
      assert.strictEqual(turnSearchByWrongPathRole.body.total, 0);

      const filteredTurnSearch = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/turn-search?event_mode=extended&has=memory_disabled"
      });
      assert.strictEqual(filteredTurnSearch.statusCode, 200);
      assert.strictEqual(filteredTurnSearch.body.total, 1);
      assert.strictEqual(filteredTurnSearch.body.sessionCount, 1);
      assert.strictEqual(filteredTurnSearch.body.turns[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137228");

      const turn = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/turn?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228&turn=turn-1&path=history.js"
      });
      assert.strictEqual(turn.statusCode, 200);
      assert.strictEqual(turn.body.turn.turnId, "turn-1");
      assert.ok(turn.body.events.some((event) => event.kind === "tool_output"));
      assert.deepStrictEqual(turn.body.events[0].commandPaths, ["/repo/a/src/history.js"]);

      const fuzzyTurn = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/turn?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228&turn=turn-1&query=featre-toggle&query_mode=fuzzy"
      });
      assert.strictEqual(fuzzyTurn.statusCode, 200);
      assert.strictEqual(fuzzyTurn.body.queryMode, "fuzzy");
      assert.deepStrictEqual(fuzzyTurn.body.turn.matchedQueries, ["feature-toggle"]);
      assert.ok(fuzzyTurn.body.events.some((event) => Array.isArray(event.matchedQueries) && event.matchedQueries.includes("feature-toggle")));

      const artifactTurns = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/artifact-turns?kind=command&value=git%20status%20--short&cwd=%2Frepo%2Fa"
      });
      assert.strictEqual(artifactTurns.statusCode, 200);
      assert.strictEqual(artifactTurns.body.turnCount, 1);
      assert.strictEqual(artifactTurns.body.sessionCount, 1);
      assert.strictEqual(artifactTurns.body.turns[0].turnId, "turn-1");

      const pathArtifactTurns = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/artifact-turns?kind=path&value=%2Frepo%2Fa%2Fsrc%2Fhistory.js&cwd=%2Frepo%2Fa"
      });
      assert.strictEqual(pathArtifactTurns.statusCode, 200);
      assert.strictEqual(pathArtifactTurns.body.turnCount, 2);
      assert.ok(pathArtifactTurns.body.turns.some((turn) => turn.turnId === "turn-1"));
      assert.ok(pathArtifactTurns.body.turns.some((turn) => turn.turnId === "turn-2"));
      assert.ok(pathArtifactTurns.body.turns.every((turn) => turn.matchRoles.includes("read") || turn.matchRoles.includes("search_scope")));

      const relativePathArtifactTurns = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/artifact-turns?kind=path&value=.%2Fsrc%2Fhistory.js&cwd=%2Frepo%2Fa"
      });
      assert.strictEqual(relativePathArtifactTurns.statusCode, 200);
      assert.strictEqual(relativePathArtifactTurns.body.turnCount, 2);
      assert.strictEqual(relativePathArtifactTurns.body.value, "/repo/a/src/history.js");

      const pathThread = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/path-thread?value=src%2Fhistory.js&cwd=%2Frepo%2Fa&session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228&event_limit=10&path_role=read"
      });
      assert.strictEqual(pathThread.statusCode, 200);
      assert.strictEqual(pathThread.body.path, "/repo/a/src/history.js");
      assert.strictEqual(pathThread.body.pathRole, "read");
      assert.strictEqual(pathThread.body.turnCount, 1);
      assert.strictEqual(pathThread.body.threads[0].turnId, "turn-1");
      assert.ok(pathThread.body.threads[0].events.some((event) => event.kind === "tool_call"));
      assert.ok(pathThread.body.threads[0].events.some((event) => event.kind === "tool_output"));
      assert.ok(pathThread.body.threads[0].actions.includes("read"));
      assert.ok(pathThread.body.threads[0].matchRoles.includes("read"));

      const related = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/related?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228"
      });
      assert.strictEqual(related.statusCode, 200);
      assert.strictEqual(related.body.total, 1);
      assert.strictEqual(related.body.sessions[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137229");
      assert.ok(related.body.sessions[0].shared.paths.includes("/repo/a/src/history.js"));

      const compactRelated = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/related?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228&shape=compact"
      });
      assert.strictEqual(compactRelated.statusCode, 200);
      assert.strictEqual(compactRelated.body.shape, "compact");
      assert.strictEqual(compactRelated.body.total, 1);
      assert.strictEqual(compactRelated.body.source.pathsReferenced, undefined);
      assert.strictEqual(compactRelated.body.sessions[0].filePath, undefined);

      const annotateProjectListSession = await requestJson({
        method: "POST",
        port,
        pathname: "/catalog/annotate/session",
        body: {
          session_id: "codex:019d23d4-f1a9-7633-b9c7-758327137228",
          bookmarked: true,
          tags: ["anchor"],
          note: "workspace anchor",
        },
      });
      assert.strictEqual(annotateProjectListSession.statusCode, 200);

      const annotateProjectListTurn = await requestJson({
        method: "POST",
        port,
        pathname: "/catalog/annotate/turn",
        body: {
          session_id: "codex:019d23d4-f1a9-7633-b9c7-758327137229",
          turn_id: "turn-2",
          tags: ["fix"],
          note: "workspace turn",
        },
      });
      assert.strictEqual(annotateProjectListTurn.statusCode, 200);

      const projects = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/projects?q=repo%2Fa"
      });
      assert.strictEqual(projects.statusCode, 200);
      assert.strictEqual(projects.body.total, 2);
      const repoAProjectCard = projects.body.projects.find((item) => item.cwd === "/repo/a");
      assert.ok(repoAProjectCard);
      assert.ok(repoAProjectCard.topFiles.every((item) => {
        if (!String(item.file || "").startsWith("/repo/a/")) return true;
        return item.displayFile === path.relative("/repo/a", item.file).split(path.sep).join("/");
      }));
      assert.ok(repoAProjectCard.topPaths.every((item) => {
        if (!String(item.path || "").startsWith("/repo/a/")) return true;
        return item.displayPath === path.relative("/repo/a", item.path).split(path.sep).join("/");
      }));
      assert.strictEqual(repoAProjectCard.topFocusRoots[0].root, "docs");
      assert.deepStrictEqual(repoAProjectCard.manualCounts, {
        annotatedSessions: 1,
        bookmarkedSessions: 1,
        annotatedTurns: 1,
        bookmarkedTurns: 0,
      });
      assert.deepStrictEqual(repoAProjectCard.topManualTags, [
        { tag: "anchor", count: 1 },
        { tag: "fix", count: 1 },
      ]);
      assert.strictEqual(repoAProjectCard.matchedManualCounts, null);
      assert.deepStrictEqual(repoAProjectCard.matchedTopManualTags, []);

      const areas = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/areas?cwd=%2Frepo%2Fa&q=guide"
      });
      assert.strictEqual(areas.statusCode, 200);
      assert.strictEqual(areas.body.total, 1);
      assert.strictEqual(areas.body.areas[0].cwd, "/repo/a");
      assert.strictEqual(areas.body.areas[0].root, "docs");
      assert.ok(areas.body.areas[0].matchReasons.includes("files"));

      const compactProjects = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/projects?q=repo%2Fa&shape=compact"
      });
      assert.strictEqual(compactProjects.statusCode, 200);
      assert.strictEqual(compactProjects.body.shape, "compact");
      assert.strictEqual(compactProjects.body.total, 2);
      assert.strictEqual(compactProjects.body.facets, undefined);
      const compactRepoAProjectCard = compactProjects.body.projects.find((item) => item.cwd === "/repo/a");
      assert.ok(compactRepoAProjectCard);
      assert.strictEqual(compactRepoAProjectCard.recentSessions, undefined);
      assert.strictEqual(compactRepoAProjectCard.topFocusRoots[0].root, "docs");
      assert.deepStrictEqual(compactRepoAProjectCard.manualCounts, {
        annotatedSessions: 1,
        bookmarkedSessions: 1,
        annotatedTurns: 1,
        bookmarkedTurns: 0,
      });
      assert.deepStrictEqual(compactRepoAProjectCard.topManualTags, [
        { tag: "anchor", count: 1 },
        { tag: "fix", count: 1 },
      ]);
      assert.strictEqual(compactRepoAProjectCard.matchedManualCounts, null);
      assert.deepStrictEqual(compactRepoAProjectCard.matchedTopManualTags, []);

      const focusedProjects = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/projects?q=confirmed%20history%20layer"
      });
      assert.strictEqual(focusedProjects.statusCode, 200);
      assert.strictEqual(focusedProjects.body.total, 1);
      assert.deepStrictEqual(focusedProjects.body.projects[0].manualCounts, {
        annotatedSessions: 1,
        bookmarkedSessions: 1,
        annotatedTurns: 1,
        bookmarkedTurns: 0,
      });
      assert.deepStrictEqual(focusedProjects.body.projects[0].topManualTags, [
        { tag: "anchor", count: 1 },
        { tag: "fix", count: 1 },
      ]);
      assert.deepStrictEqual(focusedProjects.body.projects[0].matchedManualCounts, {
        annotatedSessions: 0,
        bookmarkedSessions: 0,
        annotatedTurns: 1,
        bookmarkedTurns: 0,
      });
      assert.deepStrictEqual(focusedProjects.body.projects[0].matchedTopManualTags, [
        { tag: "fix", count: 1 },
      ]);

      const filteredProjects = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/projects?memory_mode=disabled"
      });
      assert.strictEqual(filteredProjects.statusCode, 200);
      assert.strictEqual(filteredProjects.body.total, 1);
      assert.strictEqual(filteredProjects.body.projects[0].cwd, "/repo/a");

      const annotateIgnoredProjectSession = await requestJson({
        method: "POST",
        port,
        pathname: "/catalog/annotate/session",
        body: {
          session_id: "codex:019d23d4-f1a9-7633-b9c7-758327137229",
          tags: ["ignored"],
          note: "outside the filtered project view",
        },
      });
      assert.strictEqual(annotateIgnoredProjectSession.statusCode, 200);

      const annotateProjectSession = await requestJson({
        method: "POST",
        port,
        pathname: "/catalog/annotate/session",
        body: {
          session_id: "codex:019d23d4-f1a9-7633-b9c7-758327137228",
          bookmarked: true,
          tags: ["anchor"],
          note: "project anchor",
        },
      });
      assert.strictEqual(annotateProjectSession.statusCode, 200);

      const annotateProjectTurn = await requestJson({
        method: "POST",
        port,
        pathname: "/catalog/annotate/turn",
        body: {
          session_id: "codex:019d23d4-f1a9-7633-b9c7-758327137228",
          turn_id: "turn-1",
          tags: ["fix"],
          note: "important project turn",
        },
      });
      assert.strictEqual(annotateProjectTurn.statusCode, 200);

      const project = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/project?cwd=%2Frepo%2Fa&path=history.js&command_type=read"
      });
      assert.strictEqual(project.statusCode, 200);
      assert.strictEqual(project.body.cwd, "/repo/a");
      assert.strictEqual(project.body.matchedSessionCount, 1);
      assert.strictEqual(project.body.matchedTurnCount, 1);
      assert.strictEqual(project.body.turns[0].turnId, "turn-1");
      assert.deepStrictEqual(project.body.turns[0].matchedPaths, ["/repo/a/src/history.js"]);
      assert.ok(project.body.topPaths.some((item) => item.path === "/repo/a/src/history.js"));
      assert.strictEqual(project.body.manual.annotatedSessions, 1);
      assert.strictEqual(project.body.manual.bookmarkedSessions, 1);
      assert.strictEqual(project.body.manual.annotatedTurns, 1);
      assert.strictEqual(project.body.manual.bookmarkedTurns, 0);
      assert.deepStrictEqual(project.body.manual.topTags, [
        { tag: "anchor", count: 1 },
        { tag: "fix", count: 1 },
      ]);
      assert.strictEqual(project.body.manual.sessionHighlights[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137228");
      assert.strictEqual(project.body.manual.turnHighlights[0].turnId, "turn-1");
      assert.strictEqual(project.body.areaCount, 1);
      assert.strictEqual(project.body.selectedArea, null);
      assert.deepStrictEqual(project.body.unscopedAreaReasons, { sessions: [], turns: [] });
      assert.deepStrictEqual(project.body.unscopedAreaSamples, { sessions: [], turns: [] });
      assert.deepStrictEqual(project.body.areas.map((item) => item.root), ["src"]);

      const fuzzyProjectByQuery = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/project?cwd=%2Frepo%2Fa&query=featre-toggle&query_mode=fuzzy"
      });
      assert.strictEqual(fuzzyProjectByQuery.statusCode, 200);
      assert.strictEqual(fuzzyProjectByQuery.body.queryMode, "fuzzy");
      assert.ok(fuzzyProjectByQuery.body.turns.some((turn) => Array.isArray(turn.matchedQueries) && turn.matchedQueries.includes("feature-toggle")));

      const docsProject = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/project?cwd=%2Frepo%2Fa&area=docs"
      });
      assert.strictEqual(docsProject.statusCode, 200);
      assert.strictEqual(docsProject.body.selectedArea, "docs");
      assert.strictEqual(docsProject.body.selectedAreaMatched, true);
      assert.strictEqual(docsProject.body.areaCount, 2);
      assert.strictEqual(docsProject.body.matchedSessionCount, 1);
      assert.strictEqual(docsProject.body.matchedTurnCount, 1);
      assert.strictEqual(docsProject.body.sessions[0].focusRoot, "docs");
      assert.strictEqual(docsProject.body.turns[0].focusRoot, "docs");
      assert.strictEqual(docsProject.body.turns[0].turnId, "turn-docs");

      const docsArea = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/area?cwd=%2Frepo%2Fa&area=docs"
      });
      assert.strictEqual(docsArea.statusCode, 200);
      assert.strictEqual(docsArea.body.cwd, "/repo/a");
      assert.strictEqual(docsArea.body.root, "docs");
      assert.strictEqual(docsArea.body.areaMatched, true);
      assert.strictEqual(docsArea.body.area.root, "docs");
      assert.strictEqual(docsArea.body.matchedSessionCount, 1);
      assert.strictEqual(docsArea.body.matchedTurnCount, 1);
      assert.strictEqual(docsArea.body.sessions[0].focusRoot, "docs");
      assert.strictEqual(docsArea.body.turns[0].focusRoot, "docs");

      const fuzzySrcArea = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/area?cwd=%2Frepo%2Fa&area=src&query=featre-toggle&query_mode=fuzzy"
      });
      assert.strictEqual(fuzzySrcArea.statusCode, 200);
      assert.strictEqual(fuzzySrcArea.body.queryMode, "fuzzy");
      assert.ok(fuzzySrcArea.body.turns.some((turn) => Array.isArray(turn.matchedQueries) && turn.matchedQueries.includes("feature-toggle")));

      const missingArea = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/area?cwd=%2Frepo%2Fa&area=missing-area"
      });
      assert.strictEqual(missingArea.statusCode, 200);
      assert.strictEqual(missingArea.body.root, "missing-area");
      assert.strictEqual(missingArea.body.areaMatched, false);
      assert.strictEqual(missingArea.body.area, null);
      assert.strictEqual(missingArea.body.matchedSessionCount, 0);
      assert.strictEqual(missingArea.body.matchedTurnCount, 0);

      const areaCards = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/areas?cwd=%2Frepo%2Fa"
      });
      assert.strictEqual(areaCards.statusCode, 200);
      assert.strictEqual(areaCards.body.total, 2);
      assert.ok(areaCards.body.areas.every((item) => item.cwd === "/repo/a"));
      const srcArea = areaCards.body.areas.find((item) => item.root === "src");
      assert.ok(srcArea);
      assert.deepStrictEqual(srcArea.manualCounts, {
        annotatedSessions: 2,
        bookmarkedSessions: 1,
        annotatedTurns: 2,
        bookmarkedTurns: 0,
      });
      assert.deepStrictEqual(srcArea.topManualTags, [
        { tag: "fix", count: 2 },
        { tag: "anchor", count: 1 },
        { tag: "ignored", count: 1 },
      ]);

      const fuzzyAreasByQuery = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/areas?cwd=%2Frepo%2Fa&query=featre-toggle&query_mode=fuzzy"
      });
      assert.strictEqual(fuzzyAreasByQuery.statusCode, 200);
      assert.strictEqual(fuzzyAreasByQuery.body.queryMode, "fuzzy");
      assert.strictEqual(fuzzyAreasByQuery.body.total, 1);
      assert.strictEqual(fuzzyAreasByQuery.body.areas[0].root, "src");

      const pathPatternSessions = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?cwd=%2Frepo%2Fa&path_pattern=*.test.js"
      });
      assert.strictEqual(pathPatternSessions.statusCode, 200);
      assert.strictEqual(pathPatternSessions.body.total, 1);
      assert.deepStrictEqual(pathPatternSessions.body.sessions[0].matchedPathPatterns, ["/repo/a/src/**/*.test.js"]);

      const pathPatternProject = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/project?cwd=%2Frepo%2Fa&path_pattern=*.test.js"
      });
      assert.strictEqual(pathPatternProject.statusCode, 200);
      assert.strictEqual(pathPatternProject.body.matchedSessionCount, 1);
      assert.strictEqual(pathPatternProject.body.matchedTurnCount, 1);
      assert.deepStrictEqual(pathPatternProject.body.turns[0].matchedPathPatterns, ["/repo/a/src/**/*.test.js"]);

      const transcriptByPathRole = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/transcript?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228&path_role=search_scope&source=rollout"
      });
      assert.strictEqual(transcriptByPathRole.statusCode, 200);
      assert.strictEqual(transcriptByPathRole.body.matchedItems, 1);
      assert.deepStrictEqual(transcriptByPathRole.body.items[0].commandPathPatterns, ["/repo/a/src/**/*.test.js"]);

      const commandOpSessions = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?cwd=%2Frepo%2Fa&command_op=sed"
      });
      assert.strictEqual(commandOpSessions.statusCode, 200);
      assert.strictEqual(commandOpSessions.body.total, 1);
      assert.strictEqual(commandOpSessions.body.sessions[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137228");
      assert.ok(commandOpSessions.body.sessions[0].commandOps.includes("sed"));

      const commandOpSignalSessions = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?cwd=%2Frepo%2Fa&command_op=sed&command_op_signal=high"
      });
      assert.strictEqual(commandOpSignalSessions.statusCode, 200);
      assert.strictEqual(commandOpSignalSessions.body.total, 1);
      assert.ok(commandOpSignalSessions.body.sessions[0].commandOps.includes("sed"));
      assert.deepStrictEqual(commandOpSignalSessions.body.sessions[0].matchedCommandOps, ["sed"]);

      const commandOpSignalMismatch = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?cwd=%2Frepo%2Fa&command_op=sed&command_op_signal=low"
      });
      assert.strictEqual(commandOpSignalMismatch.statusCode, 200);
      assert.strictEqual(commandOpSignalMismatch.body.total, 0);

      const mediumCommandOpSignalSessions = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?cwd=%2Frepo%2Fa&command_op_signal=medium"
      });
      assert.strictEqual(mediumCommandOpSignalSessions.statusCode, 200);
      assert.strictEqual(mediumCommandOpSignalSessions.body.total, 1);
      assert.deepStrictEqual(mediumCommandOpSignalSessions.body.sessions[0].matchedCommandOps, ["git"]);

      const commandOpProject = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/project?cwd=%2Frepo%2Fa&command_op=sed"
      });
      assert.strictEqual(commandOpProject.statusCode, 200);
      assert.strictEqual(commandOpProject.body.matchedSessionCount, 1);
      assert.strictEqual(commandOpProject.body.matchedTurnCount, 1);
      assert.ok(commandOpProject.body.sessions[0].commandOps.includes("sed"));
      assert.ok(commandOpProject.body.turns[0].commandOps.includes("sed"));

      const commandOpArtifacts = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/artifacts?kind=command_op&q=sed&command_op_signal=high"
      });
      assert.strictEqual(commandOpArtifacts.statusCode, 200);
      assert.strictEqual(commandOpArtifacts.body.artifacts[0].value, "sed");
      assert.strictEqual(commandOpArtifacts.body.artifacts[0].signalTier, "high");

      const compactArtifacts = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/artifacts?kind=query&q=feature-toggle&shape=compact"
      });
      assert.strictEqual(compactArtifacts.statusCode, 200);
      assert.strictEqual(compactArtifacts.body.shape, "compact");
      assert.strictEqual(compactArtifacts.body.total, 1);
      assert.strictEqual(compactArtifacts.body.artifacts[0].sessions, undefined);

      const compactArtifact = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/artifact?kind=command&value=git%20status%20--short&shape=compact"
      });
      assert.strictEqual(compactArtifact.statusCode, 200);
      assert.strictEqual(compactArtifact.body.shape, "compact");
      assert.strictEqual(compactArtifact.body.sessions[0].filePath, undefined);
      assert.deepStrictEqual(compactArtifact.body.sessions[0].turns[0].matchValues, ["git status --short"]);
      assert.ok(Array.isArray(compactArtifact.body.sessions[0].turns[0].commandOps));

      const compactArtifactTurns = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/artifact-turns?kind=command&value=git%20status%20--short&cwd=%2Frepo%2Fa&shape=compact"
      });
      assert.strictEqual(compactArtifactTurns.statusCode, 200);
      assert.strictEqual(compactArtifactTurns.body.shape, "compact");
      assert.strictEqual(compactArtifactTurns.body.turns[0].filePath, undefined);
      assert.deepStrictEqual(compactArtifactTurns.body.turns[0].matchValues, ["git status --short"]);
      assert.ok(compactArtifactTurns.body.turns[0].counts);

      const pagedPathArtifactTurns = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/artifact-turns?kind=path&value=%2Frepo%2Fa%2Fsrc%2Fhistory.js&cwd=%2Frepo%2Fa&limit=1&offset=1"
      });
      assert.strictEqual(pagedPathArtifactTurns.statusCode, 200);
      assert.strictEqual(pagedPathArtifactTurns.body.offset, 1);
      assert.strictEqual(pagedPathArtifactTurns.body.turnCount, 2);
      assert.strictEqual(pagedPathArtifactTurns.body.turns.length, 1);
      assert.strictEqual(pagedPathArtifactTurns.body.turns[0].turnId, "turn-1");

      const session = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/session?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228"
      });
      assert.strictEqual(session.statusCode, 200);
      assert.strictEqual(session.body.turnCount, 1);
      assert.ok(session.body.sessionKey);
      assert.strictEqual(session.body.rolloutPersistence.memoryMode, "disabled");
      assert.strictEqual(session.body.rolloutPersistence.eventMode, "extended_observed");

      const sessionByKey = await requestJson({
        method: "GET",
        port,
        pathname: `/catalog?session_key=${encodeURIComponent(session.body.sessionKey)}`
      });
      assert.strictEqual(sessionByKey.statusCode, 200);
      assert.strictEqual(sessionByKey.body.total, 1);
      assert.strictEqual(sessionByKey.body.sessions[0].sessionKey, session.body.sessionKey);

      const turns = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/turns?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228"
      });
      assert.strictEqual(turns.statusCode, 200);
      assert.strictEqual(turns.body.turnCount, 1);

      const rawSession = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/session?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137230&history_mode=raw"
      });
      assert.strictEqual(rawSession.statusCode, 200);
      assert.strictEqual(rawSession.body.historyMode, "raw");
      assert.strictEqual(rawSession.body.turnCount, 2);
      assert.strictEqual(rawSession.body.rolloutPersistence.eventMode, "extended_observed");
      assert.ok(rawSession.body.rolloutPersistence.observedEventKeys.includes("event_msg:patch_apply_end"));

      const events = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/events?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228&kind=message"
      });
      assert.strictEqual(events.statusCode, 200);
      assert.strictEqual(events.body.matchedEvents, 1);
      assert.strictEqual(events.body.events[0].kind, "message");

      const queryEvents = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/events?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228&query=feature-toggle"
      });
      assert.strictEqual(queryEvents.statusCode, 200);
      assert.ok(queryEvents.body.matchedEvents >= 1);
      assert.ok(queryEvents.body.events.some((event) => Array.isArray(event.matchedQueries) && event.matchedQueries.includes("feature-toggle")));

      const fuzzyQueryEvents = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/events?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228&query=featre-toggle&query_mode=fuzzy"
      });
      assert.strictEqual(fuzzyQueryEvents.statusCode, 200);
      assert.strictEqual(fuzzyQueryEvents.body.queryMode, "fuzzy");
      assert.ok(fuzzyQueryEvents.body.matchedEvents >= 1);
      assert.ok(fuzzyQueryEvents.body.events.some((event) => Array.isArray(event.matchedQueries) && event.matchedQueries.includes("feature-toggle")));

      const rawEvents = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/events?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137230&history_mode=raw"
      });
      assert.strictEqual(rawEvents.statusCode, 200);
      assert.ok(rawEvents.body.events.some((event) => event.turnId === "turn-drop"));
      assert.ok(rawEvents.body.events.some((event) => event.includedInFinalHistory === false));

      const transcript = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/transcript?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228&path=history.js&path_role=read&command_type=read&source=rollout"
      });
      assert.strictEqual(transcript.statusCode, 200);
      assert.strictEqual(transcript.body.quality.mode, "derived_extended_rollout");
      assert.strictEqual(transcript.body.quality.memoryMode, "disabled");
      assert.strictEqual(transcript.body.quality.eventMode, "extended_observed");
      assert.strictEqual(transcript.body.matchedItems, 1);
      assert.strictEqual(transcript.body.items[0].type, "tool");
      assert.strictEqual(transcript.body.items[0].stage, "paired");
      assert.deepStrictEqual(transcript.body.items[0].commandPaths, ["/repo/a/src/history.js"]);
      assert.ok(transcript.body.items[0].pathRoles.read.includes("/repo/a/src/history.js"));

      const transcriptByCommandOp = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/transcript?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228&command_op=sed&source=rollout"
      });
      assert.strictEqual(transcriptByCommandOp.statusCode, 200);
      assert.strictEqual(transcriptByCommandOp.body.matchedItems, 1);
      assert.ok(transcriptByCommandOp.body.items[0].shellCommands.includes("sed"));

      const transcriptByCommandOpSignal = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/transcript?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228&command_op_signal=high&source=rollout"
      });
      assert.strictEqual(transcriptByCommandOpSignal.statusCode, 200);
      assert.ok(transcriptByCommandOpSignal.body.items.some((item) => Array.isArray(item.shellCommands) && item.shellCommands.includes("sed")));

      const transcriptByPathPattern = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/transcript?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228&path_pattern=*.test.js&path_role=search_scope&source=rollout"
      });
      assert.strictEqual(transcriptByPathPattern.statusCode, 200);
      assert.strictEqual(transcriptByPathPattern.body.matchedItems, 1);
      assert.deepStrictEqual(transcriptByPathPattern.body.items[0].commandPathPatterns, ["/repo/a/src/**/*.test.js"]);

      const transcriptByQuery = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/transcript?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228&query=feature-toggle&source=rollout"
      });
      assert.strictEqual(transcriptByQuery.statusCode, 200);
      assert.strictEqual(transcriptByQuery.body.matchedItems, 1);
      assert.deepStrictEqual(transcriptByQuery.body.items[0].matchedQueries, ["feature-toggle"]);

      const fuzzyTranscriptByQuery = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/transcript?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228&query=featre-toggle&query_mode=fuzzy&source=rollout"
      });
      assert.strictEqual(fuzzyTranscriptByQuery.statusCode, 200);
      assert.strictEqual(fuzzyTranscriptByQuery.body.queryMode, "fuzzy");
      assert.strictEqual(fuzzyTranscriptByQuery.body.matchedItems, 1);
      assert.deepStrictEqual(fuzzyTranscriptByQuery.body.items[0].matchedQueries, ["feature-toggle"]);

      const resumeByQuery = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/resume?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228&query=feature-toggle&source=rollout&turn_limit=2"
      });
      assert.strictEqual(resumeByQuery.statusCode, 200);
      assert.strictEqual(resumeByQuery.body.turnCount, 1);
      assert.strictEqual(resumeByQuery.body.turns.length, 1);
      assert.deepStrictEqual(resumeByQuery.body.turns[0].matchedQueries, ["feature-toggle"]);
      assert.deepStrictEqual(resumeByQuery.body.highlights.queries, ["feature-toggle"]);
      assert.match(resumeByQuery.body.text, /Matched queries: feature-toggle/);

      const fuzzyResumeByQuery = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/resume?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228&query=featre-toggle&query_mode=fuzzy&source=rollout&turn_limit=2"
      });
      assert.strictEqual(fuzzyResumeByQuery.statusCode, 200);
      assert.strictEqual(fuzzyResumeByQuery.body.queryMode, "fuzzy");
      assert.strictEqual(fuzzyResumeByQuery.body.turnCount, 1);
      assert.deepStrictEqual(fuzzyResumeByQuery.body.turns[0].matchedQueries, ["feature-toggle"]);

      const resume = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/resume?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228&tool_text=salient&turn_limit=1&item_chars=80&tool_chars=60&source=rollout"
      });
      assert.strictEqual(resume.statusCode, 200);
      assert.strictEqual(resume.body.quality.mode, "derived_extended_rollout");
      assert.strictEqual(resume.body.reloadSafety.decision, "ready");
      assert.strictEqual(resume.body.reloadSafety.allowed, true);
      assert.strictEqual(resume.body.turns.length, 1);
      assert.ok(resume.body.shaping.operationsApplied.includes("omit_read_and_listing_output"));
      assert.ok(resume.body.shaping.operationsApplied.includes("path_focus=role_annotated_recent"));
      assert.ok(Array.isArray(resume.body.highlights.pathHighlights));
      assert.ok(resume.body.highlights.pathHighlights.some((entry) => Array.isArray(entry.roles) && entry.roles.includes("read")));
      assert.ok(resume.body.turns[0].items.some((item) => item.textMode === "omitted" && item.omissionReason === "read_output"));
      assert.match(resume.body.text, /Path focus:/);
      assert.match(resume.body.text, /\[output omitted: read_output\]/);

      const rawResume = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/resume?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137230&history_mode=raw&reload_policy=warn"
      });
      assert.strictEqual(rawResume.statusCode, 200);
      assert.strictEqual(rawResume.body.reloadSafety.decision, "blocked");
      assert.strictEqual(rawResume.body.reloadSafety.allowed, false);
      assert.ok(rawResume.body.reloadSafety.suggestedFlags.includes("--history-mode effective"));

      const strictResume = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/resume?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228&source=rollout&reload_policy=strict"
      });
      assert.strictEqual(strictResume.statusCode, 200);
      assert.strictEqual(strictResume.body.quality.mode, "derived_extended_rollout");
      assert.strictEqual(strictResume.body.reloadSafety.decision, "ready");
      assert.strictEqual(strictResume.body.reloadSafety.allowed, true);

      const rawArtifactTurns = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/artifact-turns?kind=file&value=%2Frepo%2Fc%2Fsrc%2Fdrop.js&history_mode=raw"
      });
      assert.strictEqual(rawArtifactTurns.statusCode, 200);
      assert.strictEqual(rawArtifactTurns.body.historyMode, "raw");
      assert.strictEqual(rawArtifactTurns.body.turnCount, 1);
      assert.strictEqual(rawArtifactTurns.body.turns[0].turnId, "turn-drop");

      const artifacts = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/artifacts?kind=path&q=history.js&path_role=read"
      });
      assert.strictEqual(artifacts.statusCode, 200);
      assert.strictEqual(artifacts.body.total, 1);
      assert.strictEqual(artifacts.body.artifacts[0].value, "/repo/a/src/history.js");
      assert.ok(artifacts.body.artifacts[0].pathRoles.includes("read"));

      const writeArtifacts = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/artifacts?kind=path&q=history.js&path_role=write"
      });
      assert.strictEqual(writeArtifacts.statusCode, 200);
      assert.strictEqual(writeArtifacts.body.total, 0);

      const filteredArtifacts = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/artifacts?kind=path&q=history.js&memory_mode=disabled"
      });
      assert.strictEqual(filteredArtifacts.statusCode, 200);
      assert.strictEqual(filteredArtifacts.body.total, 1);
      assert.strictEqual(filteredArtifacts.body.artifacts[0].value, "/repo/a/src/history.js");

      const artifact = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/artifact?kind=command&value=git%20status%20--short"
      });
      assert.strictEqual(artifact.statusCode, 200);
      assert.strictEqual(artifact.body.sessionCount, 1);
      assert.strictEqual(artifact.body.turnCount, 1);
      assert.strictEqual(artifact.body.sessions[0].turns[0].turnId, "turn-1");

      const stats = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/stats"
      });
      assert.strictEqual(stats.statusCode, 200);
      assert.strictEqual(stats.body.sessionCount, 5);
      assert.strictEqual(stats.body.projectCount, 3);
      assert.strictEqual(stats.body.extendedEventSessions, 4);
      assert.deepStrictEqual(stats.body.memoryModeCounts, { disabled: 1, enabled: 4 });
      assert.deepStrictEqual(stats.body.eventModeCounts, { extended_observed: 4, limited_or_unknown: 1 });
      assert.ok(stats.body.topPaths.some((item) => item.path === "/repo/a/src/history.js"));
      assert.ok(Array.isArray(stats.body.topActiveTools));
      assert.ok(Array.isArray(stats.body.topActiveFiles));
      assert.ok(Array.isArray(stats.body.topActivePaths));
      assert.ok(Array.isArray(stats.body.topActiveProjects));
      assert.ok(stats.body.topCommandOps.some((item) => item.signalTier === "high"));
      assert.ok(stats.body.topHighSignalCommandOps.some((item) => item.commandOp === "sed" && item.signalTier === "high"));
      assert.ok(stats.body.topProjects.some((item) => item.cwd === "/repo/a" && item.count === 3));
      assert.ok(stats.body.topActiveProjects.some((item) => item.cwd === "/repo/a" && item.count >= 3));
      assert.ok(typeof stats.body.reuseCandidates === "number");
      assert.ok(typeof stats.body.reuseFailures === "number");
      assert.ok(stats.body.reuseFailureCounts && typeof stats.body.reuseFailureCounts === "object");
      assert.ok((stats.body.rebuiltFiles + stats.body.reusedFiles) >= 1);

      const doctor = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/doctor?status=rebuilt"
      });
      assert.strictEqual(doctor.statusCode, 200);
      assert.ok(Array.isArray(doctor.body.files));
      assert.ok(doctor.body.files.every((item) => item.buildStatus === "rebuilt"));
      assert.ok(typeof doctor.body.liveWindowMs === "number");

      const schema = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/schema?q=exec_command_end"
      });
      assert.strictEqual(schema.statusCode, 200);
      assert.strictEqual(schema.body.totalMatchedKeys, 1);
      assert.strictEqual(schema.body.keys[0].key, "event_msg:exec_command_end");
      assert.ok(schema.body.keys[0].rawFields.some((field) => field.path === "payload.parsed_cmd[].path"));
      assert.ok(schema.body.keys[0].normalizedFields.some((field) => field.path === "commandPaths"));

      const bridgeThreads = await requestJson({
        method: "GET",
        port,
        pathname: "/bridge/threads?q=bridge&cwd=%2Frepo%2Fa&sort=updated_at&model_provider=openai&source_kind=sub-agent-thread-spawn&source_kind=cli&archived=false"
      });
      assert.strictEqual(bridgeThreads.statusCode, 200);
      assert.strictEqual(bridgeThreads.body.total, 1);
      assert.strictEqual(bridgeThreads.body.nextCursor, "next-bridge");
      assert.strictEqual(bridgeThreads.body.source.selectionReason, "app_server_only_operation");
      assert.match(bridgeThreads.body.source.selectionNote, /exact bridge-only/);
      assert.strictEqual(bridgeThreads.body.threads[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137228");
      assert.deepStrictEqual(lastBridgeListParams, {
        cursor: undefined,
        limit: undefined,
        sortKey: "updated_at",
        sortDirection: undefined,
        useStateDbOnly: undefined,
        modelProviders: ["openai"],
        sourceKinds: ["subAgentThreadSpawn", "cli"],
        cwd: "/repo/a",
        searchTerm: "bridge",
        archived: false,
      });

      const invalidBridgeThreads = await requestJson({
        method: "GET",
        port,
        pathname: "/bridge/threads?source_kind=not-real"
      });
      assert.strictEqual(invalidBridgeThreads.statusCode, 400);
      assert.match(invalidBridgeThreads.body.error, /source kind must be one of/i);

      const blankBridgeProvider = await requestJson({
        method: "GET",
        port,
        pathname: "/bridge/threads?model_provider="
      });
      assert.strictEqual(blankBridgeProvider.statusCode, 400);
      assert.match(blankBridgeProvider.body.error, /model-provider value is required/i);

      const blankBridgeSort = await requestJson({
        method: "GET",
        port,
        pathname: "/bridge/threads?sort_key="
      });
      assert.strictEqual(blankBridgeSort.statusCode, 400);
      assert.match(blankBridgeSort.body.error, /sort key is required/i);

      const invalidBridgeLimit = await requestJson({
        method: "GET",
        port,
        pathname: "/bridge/threads?limit=0"
      });
      assert.strictEqual(invalidBridgeLimit.statusCode, 400);
      assert.match(invalidBridgeLimit.body.error, /limit must be a positive integer/i);

      const bridgeLoaded = await requestJson({
        method: "GET",
        port,
        pathname: "/bridge/loaded"
      });
      assert.strictEqual(bridgeLoaded.statusCode, 200);
      assert.strictEqual(bridgeLoaded.body.total, 1);
      assert.strictEqual(bridgeLoaded.body.source.selectionReason, "app_server_only_operation");
      assert.match(bridgeLoaded.body.source.selectionNote, /exact bridge-only/);
      assert.strictEqual(bridgeLoaded.body.threads[0].threadId, "019d23d4-f1a9-7633-b9c7-758327137228");

      const bridgeThread = await requestJson({
        method: "GET",
        port,
        pathname: "/bridge/thread?session_id=codex:019d23d4-f1a9-7633-b9c7-758327137228"
      });
      assert.strictEqual(bridgeThread.statusCode, 200);
      assert.strictEqual(bridgeThread.body.source.selectionReason, "app_server_only_operation");
      assert.match(bridgeThread.body.source.selectionNote, /exact bridge-only/);
      assert.strictEqual(bridgeThread.body.thread.turnCount, 1);
      assert.deepStrictEqual(bridgeThread.body.thread.itemTypes, ["userMessage", "agentMessage"]);

      const namedThread = await requestJson({
        method: "POST",
        port,
        pathname: "/bridge/thread/name",
        body: {
          session_id: "codex:019d23d4-f1a9-7633-b9c7-758327137228",
          name: "Bridge parser session",
        },
      });
      assert.strictEqual(namedThread.statusCode, 200);
      assert.strictEqual(namedThread.body.source.selectionReason, "app_server_only_operation");
      assert.match(namedThread.body.source.selectionNote, /exact bridge-only/);
      assert.strictEqual(namedThread.body.thread.name, "Bridge parser session");

      const metadataThread = await requestJson({
        method: "POST",
        port,
        pathname: "/bridge/thread/metadata",
        body: {
          session_id: "codex:019d23d4-f1a9-7633-b9c7-758327137228",
          git_branch: "release/main",
          clear_git_sha: true,
        },
      });
      assert.strictEqual(metadataThread.statusCode, 200);
      assert.strictEqual(metadataThread.body.source.selectionReason, "app_server_only_operation");
      assert.match(metadataThread.body.source.selectionNote, /exact bridge-only/);
      assert.deepStrictEqual(metadataThread.body.thread.gitInfo, {
        branch: "release/main",
        sha: null,
        originUrl: "https://example.test/repo.git",
      });

      const memoryModeThread = await requestJson({
        method: "POST",
        port,
        pathname: "/bridge/thread/memory-mode",
        body: {
          session_id: "codex:019d23d4-f1a9-7633-b9c7-758327137228",
          mode: "disabled",
        },
      });
      assert.strictEqual(memoryModeThread.statusCode, 200);
      assert.strictEqual(memoryModeThread.body.source.selectionReason, "app_server_only_operation");
      assert.match(memoryModeThread.body.source.selectionNote, /exact bridge-only/);
      assert.strictEqual(memoryModeThread.body.sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137228");
      assert.strictEqual(memoryModeThread.body.memoryMode, "disabled");
      assert.strictEqual(bridgeThreadMemoryMode, "disabled");

      const archivedThread = await requestJson({
        method: "POST",
        port,
        pathname: "/bridge/thread/archive",
        body: {
          session_id: "codex:019d23d4-f1a9-7633-b9c7-758327137228",
        },
      });
      assert.strictEqual(archivedThread.statusCode, 200);
      assert.strictEqual(archivedThread.body.source.selectionReason, "app_server_only_operation");
      assert.match(archivedThread.body.source.selectionNote, /exact bridge-only/);
      assert.strictEqual(archivedThread.body.sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137228");
      assert.strictEqual(archivedThread.body.archived, true);

      const unarchivedThread = await requestJson({
        method: "POST",
        port,
        pathname: "/bridge/thread/unarchive",
        body: {
          session_id: "codex:019d23d4-f1a9-7633-b9c7-758327137228",
        },
      });
      assert.strictEqual(unarchivedThread.statusCode, 200);
      assert.strictEqual(unarchivedThread.body.source.selectionReason, "app_server_only_operation");
      assert.match(unarchivedThread.body.source.selectionNote, /exact bridge-only/);
      assert.strictEqual(unarchivedThread.body.thread.sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137228");
    } finally {
      await server.stop();
      machine.stop();
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }
  });

  it("exposes lineage family endpoints", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-server-lineage-"));
    const sessionDir = path.join(rootDir, "sessions");
    const dateDir = path.join(sessionDir, "2026", "04", "09");
    const indexDir = path.join(rootDir, "index");
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-server-runtime-"));
    const runtimePath = path.join(runtimeDir, "runtime.json");
    fs.mkdirSync(dateDir, { recursive: true });

    fs.writeFileSync(path.join(dateDir, "rollout-2026-04-09T15-10-51-root-session-id.jsonl"), [
      JSON.stringify({
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "root-session-id",
          cwd: "/repo/a",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-root",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-root",
          last_agent_message: "Root session finished",
        },
      }),
    ].join("\n") + "\n");

    fs.writeFileSync(path.join(dateDir, "rollout-2026-04-09T16-10-51-child-session-id.jsonl"), [
      JSON.stringify({
        timestamp: "2026-04-09T16:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "child-session-id",
          forked_from_id: "root-session-id",
          cwd: "/repo/a",
          agent_nickname: "Helmholtz",
          agent_role: "explorer",
          source: {
            subagent: {
              thread_spawn: {
                parent_thread_id: "root-session-id",
                depth: 1,
                agent_nickname: "Helmholtz",
                agent_role: "explorer",
              },
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T16:10:51.100Z",
        type: "session_meta",
        payload: {
          id: "root-session-id",
          cwd: "/repo/a",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T16:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-child",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T16:10:52.500Z",
        type: "response_item",
        payload: {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "docker",
            queries: ["docker"],
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T16:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-child",
          last_agent_message: "Child session finished",
        },
      }),
    ].join("\n") + "\n");

    const catalogStore = createHistoryStore({
      sessionDir,
      indexRoot: indexDir,
      refreshMs: 0,
    });
    catalogStore.setSessionAnnotation("root-session-id", {
      bookmarked: true,
      addTags: ["anchor"],
      note: "keep this root",
    }, { refresh: false });
    catalogStore.setSessionAnnotation("context-session-id", {
      addTags: ["related"],
      note: "useful context",
    }, { refresh: false });
    catalogStore.setTurnAnnotation("context-session-id", "turn-context", {
      bookmarked: true,
      addTags: ["fix"],
      note: "important context turn",
    }, { refresh: false });
    const machine = new CodexStateMachine();
    const server = createCodexServer({
      stateMachine: machine,
      catalogStore,
      preferredPort: 24741,
      runtimeConfigPath: runtimePath,
    });

    try {
      await server.start();
      const port = server.getPort();

      const lineageCatalog = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?lineage_root=codex:root-session-id",
      });
      assert.strictEqual(lineageCatalog.statusCode, 200);
      assert.strictEqual(lineageCatalog.body.total, 2);
      assert.ok(lineageCatalog.body.sessions.every((session) => session.lineageRootId === "codex:root-session-id"));

      const childCatalog = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?parent_thread=codex:root-session-id",
      });
      assert.strictEqual(childCatalog.statusCode, 200);
      assert.strictEqual(childCatalog.body.total, 1);
      assert.strictEqual(childCatalog.body.sessions[0].sessionId, "codex:child-session-id");

      const family = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/family?session_id=codex:child-session-id",
      });
      assert.strictEqual(family.statusCode, 200);
      assert.strictEqual(family.body.lineageRootId, "codex:root-session-id");
      assert.strictEqual(family.body.familySessionCount, 2);
      assert.strictEqual(family.body.rootSession.sessionId, "codex:root-session-id");
      assert.strictEqual(family.body.sessions[0].sessionId, "codex:root-session-id");
      assert.strictEqual(family.body.sessions[1].sessionId, "codex:child-session-id");
      assert.strictEqual(family.body.sessions[1].lineageDepth, 1);

      const fuzzyFamily = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/family?session_id=codex:child-session-id&query=dokcer&query_mode=fuzzy",
      });
      assert.strictEqual(fuzzyFamily.statusCode, 200);
      assert.strictEqual(fuzzyFamily.body.queryMode, "fuzzy");
      assert.ok(fuzzyFamily.body.turns.some((turn) => Array.isArray(turn.matchedQueries) && turn.matchedQueries.includes("docker")));
    } finally {
      await server.stop();
      machine.stop();
      fs.rmSync(rootDir, { recursive: true, force: true });
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }
  });

  it("exposes workstream endpoints", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-server-workstream-"));
    const sessionDir = path.join(rootDir, "sessions");
    const dateDir = path.join(sessionDir, "2026", "04", "09");
    const indexDir = path.join(rootDir, "index");
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-server-runtime-"));
    const runtimePath = path.join(runtimeDir, "runtime.json");
    fs.mkdirSync(dateDir, { recursive: true });

    fs.writeFileSync(path.join(dateDir, "rollout-2026-04-09T15-10-51-root-session-id.jsonl"), [
      JSON.stringify({
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "root-session-id",
          cwd: "/repo/a",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-root",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_root",
          arguments: "{\"cmd\":\"sed -n '1,120p' src/app.js\",\"workdir\":\"/repo/a\"}",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T15:10:53.100Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_root",
          turn_id: "turn-root",
          command: ["/bin/zsh", "-lc", "sed -n '1,120p' src/app.js"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "read",
            cmd: "sed -n '1,120p' src/app.js",
            path: "src/app.js",
          }],
          aggregated_output: "root\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 1000 },
          status: "completed",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-root",
          last_agent_message: "Root session finished",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T15:10:55.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-root-docs",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T15:10:56.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call_root_docs",
          turn_id: "turn-root-docs",
          success: true,
          changes: {
            "/repo/a/docs/guide.md": { type: "update" },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T15:10:57.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-root-docs",
          last_agent_message: "Root docs refreshed",
        },
      }),
    ].join("\n") + "\n");

    fs.writeFileSync(path.join(dateDir, "rollout-2026-04-09T16-10-51-child-session-id.jsonl"), [
      JSON.stringify({
        timestamp: "2026-04-09T16:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "child-session-id",
          forked_from_id: "root-session-id",
          cwd: "/repo/a",
          source: {
            subagent: {
              thread_spawn: {
                parent_thread_id: "root-session-id",
                depth: 1,
                agent_nickname: "Helmholtz",
                agent_role: "explorer",
              },
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T16:10:51.100Z",
        type: "session_meta",
        payload: {
          id: "root-session-id",
          cwd: "/repo/a",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T16:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-child",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T16:10:52.500Z",
        type: "response_item",
        payload: {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "docker",
            queries: ["docker"],
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T16:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-child",
          last_agent_message: "Child session finished",
        },
      }),
    ].join("\n") + "\n");

    fs.writeFileSync(path.join(dateDir, "rollout-2026-04-09T17-10-51-context-session-id.jsonl"), [
      JSON.stringify({
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "context-session-id",
          cwd: "/repo/a",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-context",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_context",
          arguments: "{\"cmd\":\"sed -n '1,120p' src/app.js\",\"workdir\":\"/repo/a\"}",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T17:10:53.100Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_context",
          turn_id: "turn-context",
          command: ["/bin/zsh", "-lc", "sed -n '1,120p' src/app.js"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "read",
            cmd: "sed -n '1,120p' src/app.js",
            path: "src/app.js",
          }],
          aggregated_output: "context\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 1000 },
          status: "completed",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T17:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-context",
          last_agent_message: "Context session finished",
        },
      }),
    ].join("\n") + "\n");

    const catalogStore = createHistoryStore({
      sessionDir,
      indexRoot: indexDir,
      refreshMs: 0,
    });
    catalogStore.setSessionAnnotation("root-session-id", {
      bookmarked: true,
      addTags: ["anchor"],
      note: "keep this root",
    }, { refresh: false });
    catalogStore.setSessionAnnotation("context-session-id", {
      addTags: ["related"],
      note: "useful context",
    }, { refresh: false });
    catalogStore.setTurnAnnotation("context-session-id", "turn-context", {
      bookmarked: true,
      addTags: ["fix"],
      note: "important context turn",
    }, { refresh: false });
    const machine = new CodexStateMachine();
    const server = createCodexServer({
      stateMachine: machine,
      catalogStore,
      preferredPort: 24740,
      runtimeConfigPath: runtimePath,
    });

    try {
      await server.start();
      const port = server.getPort();

      const workstream = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/workstream?session_id=codex:child-session-id&path=src%2Fapp.js&shape=compact&limit=1&family_limit=1",
      });
      assert.strictEqual(workstream.statusCode, 200);
      assert.strictEqual(workstream.body.shape, "compact");
      assert.strictEqual(workstream.body.lineageRootId, "codex:root-session-id");
      assert.strictEqual(workstream.body.familySessionCount, 2);
      assert.strictEqual(workstream.body.familyPeerCount, 1);
      assert.strictEqual(workstream.body.contextSessionCount, 1);
      assert.strictEqual(workstream.body.rootSession.sessionId, "codex:root-session-id");
      assert.strictEqual(workstream.body.rootSession.artifactSamples, undefined);
      assert.strictEqual(workstream.body.familySessions[0].sessionId, "codex:child-session-id");
      assert.strictEqual(workstream.body.familySessions[0].artifactSamples, undefined);
      assert.strictEqual(workstream.body.contextSessions[0].sessionId, "codex:context-session-id");
      assert.strictEqual(workstream.body.contextSessions[0].shared, undefined);
      assert.ok(workstream.body.contextSessions[0].sharedCounts.paths > 0);
      assert.deepStrictEqual(workstream.body.contextSessions[0].linkedSessions, ["codex:root-session-id"]);
      assert.ok(workstream.body.turns.every((turn) => turn.counts && turn.filesTouched === undefined));
      assert.ok(workstream.body.turns.some((turn) => turn.sessionId === "codex:root-session-id"));
      assert.ok(workstream.body.turns.some((turn) => turn.sessionId === "codex:context-session-id"));
      assert.strictEqual(workstream.body.manual.annotatedSessions, 2);
      assert.strictEqual(workstream.body.manual.bookmarkedSessions, 1);
      assert.strictEqual(workstream.body.manual.annotatedTurns, 1);
      assert.strictEqual(workstream.body.manual.bookmarkedTurns, 1);
      assert.deepStrictEqual(workstream.body.manual.topTags, [
        { tag: "anchor", count: 1 },
        { tag: "fix", count: 1 },
        { tag: "related", count: 1 },
      ]);
      assert.strictEqual(workstream.body.manual.sessionHighlights[0].sessionId, "codex:root-session-id");
      assert.strictEqual(workstream.body.manual.sessionHighlights[0].workstreamRole, "root");
      assert.strictEqual(workstream.body.manual.turnHighlights[0].turnId, "turn-context");
      assert.strictEqual(workstream.body.manual.turnHighlights[0].workstreamRole, "context");

      const srcAreaWorkstream = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/workstream?session_id=codex:child-session-id&area=src&shape=compact&limit=1&family_limit=1",
      });
      assert.strictEqual(srcAreaWorkstream.statusCode, 200);
      assert.strictEqual(srcAreaWorkstream.body.selectedArea, "src");
      assert.strictEqual(srcAreaWorkstream.body.selectedAreaMatched, true);
      assert.ok(srcAreaWorkstream.body.turns.length > 0);
      assert.ok(srcAreaWorkstream.body.turns.some((turn) => turn.turnId === "turn-root"));
      assert.ok(srcAreaWorkstream.body.turns.some((turn) => turn.turnId === "turn-context"));
      assert.ok(!srcAreaWorkstream.body.turns.some((turn) => turn.turnId === "turn-root-docs"));

      const fuzzyWorkstream = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/workstream?session_id=codex:child-session-id&query=dokcer&query_mode=fuzzy",
      });
      assert.strictEqual(fuzzyWorkstream.statusCode, 200);
      assert.strictEqual(fuzzyWorkstream.body.queryMode, "fuzzy");
      assert.ok(fuzzyWorkstream.body.turns.some((turn) => Array.isArray(turn.matchedQueries) && turn.matchedQueries.includes("docker")));
    } finally {
      await server.stop();
      machine.stop();
      fs.rmSync(rootDir, { recursive: true, force: true });
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }
  });

  it("supports manual annotation endpoints and filters across catalog views", async () => {
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-server-"));
    const runtimePath = path.join(runtimeDir, "runtime.json");
    const sessionRoot = path.join(runtimeDir, "sessions");
    const sessionDir = path.join(sessionRoot, "2026", "04", "09");
    const indexDir = path.join(runtimeDir, "index");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(
      sessionDir,
      "rollout-2026-04-09T18-10-51-019d-annotation-session.jsonl"
    ), [
      JSON.stringify({
        timestamp: "2026-04-09T18:10:51.000Z",
        type: "session_meta",
        payload: { id: "annotation-session", cwd: "/repo/annotated" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T18:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-1", cwd: "/repo/annotated", model: "gpt-5.4" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T18:10:53.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "review baseline state" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T18:10:54.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-1", last_agent_message: "baseline done" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T18:11:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-2", cwd: "/repo/annotated", model: "gpt-5.4" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T18:11:53.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "fix approval flow" },
      }),
      JSON.stringify({
        timestamp: "2026-04-09T18:11:54.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-2", last_agent_message: "approval fixed" },
      }),
    ].join("\n") + "\n");

    const catalogStore = createHistoryStore({
      sessionDir: sessionRoot,
      indexRoot: indexDir,
      refreshMs: 0,
      appServer: false,
    });
    const machine = new CodexStateMachine();
    const server = createCodexServer({
      stateMachine: machine,
      catalogStore,
      preferredPort: 24742,
      runtimeConfigPath: runtimePath,
    });

    try {
      await server.start();
      const port = server.getPort();

      const annotateSession = await requestJson({
        method: "POST",
        port,
        pathname: "/catalog/annotate/session",
        body: {
          session_id: "codex:annotation-session",
          bookmarked: true,
          tags: ["Important"],
          note: "resume here",
        },
      });
      assert.strictEqual(annotateSession.statusCode, 200);
      assert.strictEqual(annotateSession.body.annotation.bookmarked, true);
      assert.deepStrictEqual(annotateSession.body.annotation.tags, ["important"]);

      const bookmarkedCatalog = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog?bookmarked=true",
      });
      assert.strictEqual(bookmarkedCatalog.statusCode, 200);
      assert.strictEqual(bookmarkedCatalog.body.total, 1);
      assert.strictEqual(bookmarkedCatalog.body.sessions[0].annotation.bookmarked, true);
      assert.deepStrictEqual(bookmarkedCatalog.body.sessions[0].annotation.tags, ["important"]);

      const annotateTurn = await requestJson({
        method: "POST",
        port,
        pathname: "/catalog/annotate/turn",
        body: {
          session_id: "codex:annotation-session",
          turn_id: "turn-2",
          tags: ["fix"],
          note: "approval path",
        },
      });
      assert.strictEqual(annotateTurn.statusCode, 200);
      assert.strictEqual(annotateTurn.body.turnId, "turn-2");
      assert.deepStrictEqual(annotateTurn.body.annotation.tags, ["fix"]);

      const taggedTurnSearch = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/turn-search?manual_tag=fix",
      });
      assert.strictEqual(taggedTurnSearch.statusCode, 200);
      assert.strictEqual(taggedTurnSearch.body.total, 1);
      assert.strictEqual(taggedTurnSearch.body.turns[0].turnId, "turn-2");
      assert.deepStrictEqual(taggedTurnSearch.body.turns[0].annotation.tags, ["fix"]);

      const taggedTranscript = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/transcript?session_id=codex:annotation-session&manual_tag=fix",
      });
      assert.strictEqual(taggedTranscript.statusCode, 200);
      assert.ok(taggedTranscript.body.matchedItems > 0);
      assert.ok(taggedTranscript.body.items.every((item) => item.turnId === "turn-2"));

      const taggedEvents = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/events?session_id=codex:annotation-session&manual_tag=fix",
      });
      assert.strictEqual(taggedEvents.statusCode, 200);
      assert.ok(taggedEvents.body.matchedEvents > 0);
      assert.ok(taggedEvents.body.events.every((event) => event.turnId === "turn-2"));

      const stats = await requestJson({
        method: "GET",
        port,
        pathname: "/catalog/stats",
      });
      assert.strictEqual(stats.statusCode, 200);
      assert.strictEqual(stats.body.manualProjectCount, 1);
      assert.strictEqual(stats.body.bookmarkedProjectCount, 1);
      assert.deepStrictEqual(stats.body.topManualProjects, [
        {
          cwd: "/repo/annotated",
          updatedAt: "2026-04-09T18:11:54.000Z",
          annotatedSessions: 1,
          bookmarkedSessions: 1,
          annotatedTurns: 1,
          bookmarkedTurns: 0,
          topTags: [
            { tag: "fix", count: 1 },
            { tag: "important", count: 1 },
          ],
        },
      ]);
    } finally {
      await server.stop();
      machine.stop();
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }
  });

  it("exposes bridge prune endpoints", async () => {
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-server-"));
    const runtimePath = path.join(runtimeDir, "runtime.json");
    const sessionDir = path.join(runtimeDir, "sessions");
    const indexDir = path.join(runtimeDir, "index");
    fs.mkdirSync(sessionDir, { recursive: true });

    const threads = new Map([
      ["019d-thread-prune", {
        id: "019d-thread-prune",
        forkedFromId: null,
        preview: "prunable thread",
        ephemeral: false,
        modelProvider: "openai",
        createdAt: 1776171492,
        updatedAt: 1776171510,
        status: { type: "notLoaded" },
        path: "/tmp/019d-thread-prune.jsonl",
        cwd: "/repo/prune",
        cliVersion: "0.119.0-alpha.5",
        source: "cli",
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        name: null,
        turns: [
          {
            id: "turn-1",
            status: "completed",
            error: null,
            startedAt: 1776171493,
            completedAt: 1776171498,
            durationMs: 5000,
            items: [
              { type: "userMessage", id: "item-1", content: [{ type: "text", text: "keep this turn", text_elements: [] }] },
              { type: "agentMessage", id: "item-2", text: "first answer", phase: "final_answer", memoryCitation: null },
            ],
          },
          {
            id: "turn-2",
            status: "completed",
            error: null,
            startedAt: 1776171503,
            completedAt: 1776171508,
            durationMs: 5000,
            items: [
              { type: "userMessage", id: "item-3", content: [{ type: "text", text: "drop this turn", text_elements: [] }] },
              { type: "agentMessage", id: "item-4", text: "second answer", phase: "final_answer", memoryCitation: null },
            ],
          },
        ],
      }],
    ]);
    let lastForkOptions = null;

    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    const catalogStore = createHistoryStore({
      sessionDir,
      indexRoot: indexDir,
      refreshMs: 0,
      appServer: {
        async readThread(sessionId) {
          const id = String(sessionId).replace(/^codex:/, "");
          return { thread: clone(threads.get(id)) };
        },
        async forkThread(sessionId, options = {}) {
          const id = String(sessionId).replace(/^codex:/, "");
          lastForkOptions = { ...options };
          const source = clone(threads.get(id));
          const forkId = `${id}-fork`;
          const forked = {
            ...source,
            id: forkId,
            forkedFromId: id,
            path: `/tmp/${forkId}.jsonl`,
          };
          threads.set(forkId, forked);
          return { thread: clone(forked) };
        },
        async rollbackThread(sessionId, numTurns) {
          const id = String(sessionId).replace(/^codex:/, "");
          const thread = clone(threads.get(id));
          thread.turns = thread.turns.slice(0, Math.max(0, thread.turns.length - numTurns));
          threads.set(id, thread);
          return { thread: clone(thread) };
        },
        async setThreadName(sessionId, name) {
          const id = String(sessionId).replace(/^codex:/, "");
          const thread = clone(threads.get(id));
          thread.name = name;
          threads.set(id, thread);
          return { thread: clone(thread) };
        },
        close() {},
      },
    });

    const machine = new CodexStateMachine();
    const server = createCodexServer({
      stateMachine: machine,
      catalogStore,
      preferredPort: 24738,
      runtimeConfigPath: runtimePath,
    });

    try {
      await server.start();
      const port = server.getPort();

      const candidates = await requestJson({
        method: "GET",
        port,
        pathname: "/bridge/prune-turns?session_id=codex:019d-thread-prune&limit=2",
      });
      assert.strictEqual(candidates.statusCode, 200);
      assert.strictEqual(candidates.body.source.selectionReason, "app_server_only_operation");
      assert.match(candidates.body.source.selectionNote, /exact bridge-only/);
      assert.strictEqual(candidates.body.quality.mode, "app_server_thread_view");
      assert.strictEqual(candidates.body.candidateCount, 2);
      assert.strictEqual(candidates.body.candidates[0].turnId, "turn-1");
      assert.strictEqual(candidates.body.candidates[1].turnId, "turn-2");

      const preview = await requestJson({
        method: "GET",
        port,
        pathname: "/bridge/prune-preview?session_id=codex:019d-thread-prune&through_turn=turn-1",
      });
      assert.strictEqual(preview.statusCode, 200);
      assert.strictEqual(preview.body.source.selectionReason, "app_server_only_operation");
      assert.match(preview.body.source.selectionNote, /exact bridge-only/);
      assert.strictEqual(preview.body.quality.mode, "app_server_thread_view");
      assert.strictEqual(preview.body.appliedDropTurns, 1);
      assert.strictEqual(preview.body.remainingTurnCount, 1);
      assert.strictEqual(preview.body.selectionMode, "through_turn");

      const invalidPreview = await requestJson({
        method: "GET",
        port,
        pathname: "/bridge/prune-preview?session_id=codex:019d-thread-prune&drop_last=0",
      });
      assert.strictEqual(invalidPreview.statusCode, 400);
      assert.match(invalidPreview.body.error, /drop_last must be a positive integer/i);

      const forked = await requestJson({
        method: "POST",
        port,
        pathname: "/bridge/thread/fork-prune",
        body: {
          session_id: "codex:019d-thread-prune",
          through_turn: "turn-1",
          name: "Trimmed thread",
        },
      });
      assert.strictEqual(forked.statusCode, 200);
      assert.strictEqual(forked.body.source.selectionReason, "app_server_only_operation");
      assert.match(forked.body.source.selectionNote, /exact bridge-only/);
      assert.strictEqual(forked.body.quality.mode, "app_server_thread_view");
      assert.strictEqual(forked.body.forkedSessionId, "codex:019d-thread-prune-fork");
      assert.strictEqual(forked.body.thread.name, "Trimmed thread");
      assert.strictEqual(forked.body.remainingTurnCount, 1);
      assert.deepStrictEqual(lastForkOptions, {
        ephemeral: false,
        lastTurnId: "turn-1",
      });

      const invalidFork = await requestJson({
        method: "POST",
        port,
        pathname: "/bridge/thread/fork-prune",
        body: {
          session_id: "codex:019d-thread-prune",
          drop_last: 0,
        },
      });
      assert.strictEqual(invalidFork.statusCode, 400);
      assert.match(invalidFork.body.error, /drop_last must be a positive integer/i);
    } finally {
      await server.stop();
      machine.stop();
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }
  });
});
