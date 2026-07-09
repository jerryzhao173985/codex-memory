const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  buildBridgeThreadViewResult,
  buildBridgeThreadSessionView,
  normalizeBridgeListResponse,
  normalizeBridgeLoadedResponse,
  normalizeBridgeSessionSource,
} = require("../history-bridge-thread");
const {
  buildPrunePreviewResult,
  buildPruneTurnCandidates,
} = require("../history-bridge-prune");

describe("history bridge modules", () => {
  it("normalizes exact bridge thread views with source metadata", () => {
    const result = buildBridgeThreadViewResult({
      id: "019d-thread",
      forkedFromId: "019d-parent",
      preview: "Implement the bridge view split",
      ephemeral: false,
      modelProvider: "openai",
      createdAt: 1710000000,
      updatedAt: 1710000300,
      status: {
        type: "active",
        activeFlags: ["streaming"],
      },
      path: "/tmp/thread.json",
      cwd: "/repo",
      cliVersion: "0.1.0",
      source: "cli",
      agentNickname: "worker",
      agentRole: "default",
      gitInfo: {
        branch: "main",
        sha: "abc123",
        originUrl: "https://example.test/repo.git",
      },
      name: "Bridge thread",
      turns: [
        {
          status: "completed",
          items: [
            { type: "userMessage" },
            { type: "functionCall" },
          ],
        },
        {
          status: "running",
          items: [
            { type: "assistantMessage" },
          ],
        },
      ],
    });

    assert.ok(result);
    assert.strictEqual(result.source.selectionReason, "app_server_only_operation");
    assert.match(result.source.selectionNote, /exact bridge-only/i);
    assert.strictEqual(result.thread.threadId, "019d-thread");
    assert.strictEqual(result.thread.sessionId, "codex:019d-thread");
    assert.strictEqual(result.thread.forkedFromId, "codex:019d-parent");
    assert.strictEqual(result.thread.status.label, "active(streaming)");
    assert.strictEqual(result.thread.turnCount, 2);
    assert.deepStrictEqual(result.thread.itemTypes, [
      "userMessage",
      "functionCall",
      "assistantMessage",
    ]);
    assert.deepStrictEqual({ ...result.thread.turnStatusCounts }, {
      completed: 1,
      running: 1,
    });
  });

  it("normalizes exact bridge list and loaded responses", () => {
    const list = normalizeBridgeListResponse({
      nextCursor: "cursor-2",
      data: [
        {
          id: "019d-thread-a",
          preview: "first",
          cwd: "/repo",
          status: { type: "completed", activeFlags: [] },
          turns: [],
        },
        null,
      ],
    });
    assert.strictEqual(list.total, 1);
    assert.strictEqual(list.nextCursor, "cursor-2");
    assert.strictEqual(list.threads[0].sessionId, "codex:019d-thread-a");

    const loaded = normalizeBridgeLoadedResponse({
      nextCursor: "cursor-3",
      data: ["019d-thread-a", "", null, "019d-thread-b"],
    });
    assert.strictEqual(loaded.total, 2);
    assert.strictEqual(loaded.nextCursor, "cursor-3");
    assert.deepStrictEqual(loaded.threads, [
      { threadId: "019d-thread-a", sessionId: "codex:019d-thread-a" },
      { threadId: "019d-thread-b", sessionId: "codex:019d-thread-b" },
    ]);
  });

  it("normalizes summary-only thread/read responses without turns", () => {
    const result = buildBridgeThreadViewResult({
      id: "019d-thread-summary",
      preview: "Saved user message",
      ephemeral: false,
      modelProvider: "mock_provider",
      status: { type: "notLoaded" },
      path: "/tmp/rollout-019d-thread-summary.jsonl",
      cwd: "/",
      cliVersion: "0.0.0",
      source: "cli",
      gitInfo: null,
      turns: [],
    });

    assert.ok(result);
    assert.strictEqual(result.thread.threadId, "019d-thread-summary");
    assert.strictEqual(result.thread.preview, "Saved user message");
    assert.strictEqual(result.thread.modelProvider, "mock_provider");
    assert.strictEqual(result.thread.ephemeral, false);
    assert.strictEqual(result.thread.path, "/tmp/rollout-019d-thread-summary.jsonl");
    assert.strictEqual(result.thread.cwd, "/");
    assert.strictEqual(result.thread.cliVersion, "0.0.0");
    assert.strictEqual(result.thread.source, "cli");
    assert.strictEqual(result.thread.sourceKind, "cli");
    assert.strictEqual(result.thread.turnCount, 0);
    assert.deepStrictEqual(result.thread.itemTypes, []);
    assert.deepStrictEqual({ ...result.thread.turnStatusCounts }, {});
    assert.strictEqual(result.thread.status.type, "notLoaded");
    assert.strictEqual(result.thread.status.label, "notLoaded");
  });

  it("builds exact session views for summary-only and unmaterialized thread/read responses", () => {
    const summaryView = buildBridgeThreadSessionView({
      id: "019d-thread-summary",
      preview: "Saved user message",
      ephemeral: false,
      modelProvider: "mock_provider",
      status: { type: "notLoaded" },
      path: "/tmp/rollout-019d-thread-summary.jsonl",
      cwd: "/",
      cliVersion: "0.0.0",
      source: "cli",
      turns: [],
    });

    assert.ok(summaryView);
    assert.strictEqual(summaryView.session.sessionId, "codex:019d-thread-summary");
    assert.strictEqual(summaryView.session.filePath, "/tmp/rollout-019d-thread-summary.jsonl");
    assert.strictEqual(summaryView.session.cwd, "/");
    assert.strictEqual(summaryView.session.modelProvider, "mock_provider");
    assert.strictEqual(summaryView.session.lastUserPreview, "Saved user message");
    assert.strictEqual(summaryView.session.turnCount, 0);
    assert.deepStrictEqual(summaryView.session.turns, []);
    assert.deepStrictEqual(summaryView.transcript, []);

    const loadedView = buildBridgeThreadSessionView({
      id: "019d-thread-loaded",
      preview: "",
      ephemeral: false,
      modelProvider: "mock_provider",
      status: { type: "idle" },
      path: "/tmp/rollout-019d-thread-loaded.jsonl",
      cwd: "/repo",
      cliVersion: "0.0.0",
      source: "cli",
      turns: [],
    });

    assert.ok(loadedView);
    assert.strictEqual(loadedView.session.sessionId, "codex:019d-thread-loaded");
    assert.strictEqual(loadedView.session.filePath, "/tmp/rollout-019d-thread-loaded.jsonl");
    assert.strictEqual(loadedView.session.cwd, "/repo");
    assert.strictEqual(loadedView.session.lastUserPreview, "");
    assert.strictEqual(loadedView.session.turnCount, 0);
    assert.deepStrictEqual(loadedView.session.turns, []);
    assert.deepStrictEqual(loadedView.transcript, []);
  });

  it("preserves exact fork, source, git, and lineage metadata in session views", () => {
    const view = buildBridgeThreadSessionView({
      id: "019d-thread-forked",
      forkedFromId: "019d-parent-thread",
      preview: "forked work",
      cwd: "/repo",
      source: {
        subAgent: {
          threadSpawn: {
            parentThreadId: "019d-parent-thread",
            depth: 2,
            agentPath: "agents/reviewer",
            agentNickname: "worker",
            agentRole: "reviewer",
          },
        },
      },
      agentNickname: "worker",
      agentRole: "reviewer",
      gitInfo: {
        branch: "main",
        sha: "abc123",
        originUrl: "https://example.test/repo.git",
      },
      turns: [],
    }, {
      lineageRootId: "codex:019d-root-thread",
      lineageDepth: 3,
      lineageFamilyCount: 4,
      replayedSessionIds: ["codex:019d-replayed-thread"],
    });

    assert.ok(view);
    assert.strictEqual(view.session.forkedFromId, "codex:019d-parent-thread");
    assert.strictEqual(view.session.parentThreadId, "codex:019d-parent-thread");
    assert.strictEqual(view.session.subagentDepth, 2);
    assert.strictEqual(view.session.lineageRootId, "codex:019d-root-thread");
    assert.strictEqual(view.session.lineageDepth, 3);
    assert.strictEqual(view.session.lineageFamilyCount, 4);
    assert.deepStrictEqual(view.session.replayedSessionIds, ["codex:019d-replayed-thread"]);
    assert.strictEqual(view.session.source, "subAgentThreadSpawn");
    assert.strictEqual(view.session.sourceKind, "subAgentThreadSpawn");
    assert.deepStrictEqual(view.session.sourceDetail, {
      type: "subAgent",
      variant: "threadSpawn",
      parentThreadId: "codex:019d-parent-thread",
      depth: 2,
      agentPath: "agents/reviewer",
      agentNickname: "worker",
      agentRole: "reviewer",
    });
    assert.strictEqual(view.session.agentNickname, "worker");
    assert.strictEqual(view.session.agentRole, "reviewer");
    assert.strictEqual(view.session.agentPath, "agents/reviewer");
    assert.strictEqual(view.session.gitBranch, "main");
    assert.strictEqual(view.session.gitSha, "abc123");
    assert.strictEqual(view.session.gitOriginUrl, "https://example.test/repo.git");
    assert.ok(view.session.tags.includes("forked"));
    assert.ok(view.session.tags.includes("subagent"));
  });

  it("preserves structured app-server session sources with source kinds", () => {
    const source = normalizeBridgeSessionSource({
      subAgent: {
        threadSpawn: {
          parentThreadId: "019d-parent",
          depth: 2,
          agentPath: null,
          agentNickname: "worker",
          agentRole: "reviewer",
        },
      },
    });
    assert.deepStrictEqual(source, {
      source: "subAgentThreadSpawn",
      sourceKind: "subAgentThreadSpawn",
      sourceDetail: {
        type: "subAgent",
        variant: "threadSpawn",
        parentThreadId: "codex:019d-parent",
        depth: 2,
        agentPath: null,
        agentNickname: "worker",
        agentRole: "reviewer",
      },
    });
  });

  it("normalizes upstream systemError thread/read statuses", () => {
    const result = buildBridgeThreadViewResult({
      id: "019d-thread-system-error",
      preview: "",
      ephemeral: false,
      modelProvider: "mock_provider",
      status: { type: "systemError" },
      path: "/tmp/rollout-019d-thread-system-error.jsonl",
      cwd: "/repo",
      cliVersion: "0.0.0",
      source: "cli",
      turns: [],
    });

    assert.ok(result);
    assert.strictEqual(result.thread.status.type, "systemError");
    assert.strictEqual(result.thread.status.label, "systemError");
  });

  it("uses exact commandExecution cwd for relative path artifacts and transcript items", () => {
    const view = buildBridgeThreadSessionView({
      id: "019d-thread-cwd",
      cwd: "/repo",
      turns: [
        {
          id: "turn-1",
          startedAt: 1710000000,
          completedAt: 1710000010,
          status: "completed",
          items: [
            {
              id: "item-user",
              type: "userMessage",
              content: [{ type: "text", text: "inspect the nested file" }],
            },
            {
              id: "item-cmd",
              type: "commandExecution",
              command: "cat src/file.js",
              cwd: "/repo/packages/app",
              source: "agent",
              status: "completed",
              commandActions: [
                {
                  type: "read",
                  path: "src/file.js",
                },
              ],
              aggregatedOutput: "console.log('ok')",
              exitCode: 0,
            },
          ],
        },
      ],
    });

    assert.ok(view);
    assert.deepStrictEqual(view.session.pathsReferenced, ["/repo/packages/app/src/file.js"]);
    assert.deepStrictEqual(view.session.turns[0].commands[0].commandPaths, ["/repo/packages/app/src/file.js"]);

    const toolItem = view.transcript.find((item) => item.callId === "item-cmd");
    assert.ok(toolItem);
    assert.strictEqual(toolItem.cwd, "/repo/packages/app");
    assert.deepStrictEqual(toolItem.commandPaths, ["/repo/packages/app/src/file.js"]);
  });

  it("preserves exact assistant memory citations in transcript items", () => {
    const view = buildBridgeThreadSessionView({
      id: "019d-thread-memory",
      cwd: "/repo",
      turns: [
        {
          id: "turn-1",
          startedAt: 1710000000,
          completedAt: 1710000010,
          status: "completed",
          items: [
            {
              id: "item-agent",
              type: "agentMessage",
              text: "used memory",
              phase: "final_answer",
              memoryCitation: {
                entries: [
                  {
                    path: "MEMORY.md",
                    lineStart: 1,
                    lineEnd: 2,
                    note: "summary",
                  },
                ],
                threadIds: ["rollout-1"],
              },
            },
          ],
        },
      ],
    });

    const assistantItem = view.transcript.find((item) => item.type === "assistant");
    assert.ok(assistantItem);
    assert.deepStrictEqual(assistantItem.memoryCitation, {
      entries: [
        {
          path: "MEMORY.md",
          lineStart: 1,
          lineEnd: 2,
          note: "summary",
        },
      ],
      threadIds: ["rollout-1"],
    });
    assert.deepStrictEqual(assistantItem.memoryCitationPaths, ["/repo/MEMORY.md"]);
  });

  it("preserves structured exact turn errors in transcript items", () => {
    const view = buildBridgeThreadSessionView({
      id: "019d-thread-error",
      cwd: "/repo",
      turns: [
        {
          id: "turn-1",
          startedAt: 1710000000,
          completedAt: 1710000010,
          status: "failed",
          error: {
            message: "stream failure",
            codexErrorInfo: {
              responseStreamDisconnected: {
                httpStatusCode: 502,
              },
            },
            additionalDetails: "socket closed",
          },
          items: [
            {
              id: "item-user",
              type: "userMessage",
              content: [{ type: "text", text: "show the exact error" }],
            },
          ],
        },
      ],
    });

    const errorItem = view.transcript.find((item) => item.type === "error");
    assert.ok(errorItem);
    assert.strictEqual(errorItem.text, "stream failure");
    assert.match(errorItem.detail, /responseStreamDisconnected/);
    assert.match(errorItem.detail, /502/);
    assert.match(errorItem.detail, /socket closed/);
    assert.strictEqual(errorItem.errorCode, "responseStreamDisconnected");
    assert.strictEqual(errorItem.statusCode, 502);
    assert.deepStrictEqual(errorItem.codexErrorInfo, {
      responseStreamDisconnected: {
        httpStatusCode: 502,
      },
    });
    assert.strictEqual(errorItem.additionalDetails, "socket closed");
    assert.strictEqual(view.session.turns[0].errors[0].code, "responseStreamDisconnected");
    assert.strictEqual(view.session.turns[0].errors[0].statusCode, 502);
  });

  it("builds exact prune previews from thread snapshots", () => {
    const preview = buildPrunePreviewResult({
      id: "019d-thread-prune",
      preview: "Prune exact history",
      cwd: "/repo",
      status: { type: "completed", activeFlags: [] },
      turns: [
        {
          id: "turn-1",
          startedAt: 1710000000,
          completedAt: 1710000010,
          status: "completed",
          items: [
            {
              id: "item-1",
              type: "userMessage",
              content: [
                { type: "input_text", text: "keep this turn" },
              ],
            },
          ],
        },
        {
          id: "turn-2",
          startedAt: 1710000100,
          completedAt: 1710000110,
          status: "completed",
          items: [
            {
              id: "item-2",
              type: "userMessage",
              content: [
                { type: "input_text", text: "drop this turn" },
              ],
            },
          ],
        },
      ],
    }, null, {
      throughTurn: "turn-1",
    });

    assert.strictEqual(preview.source.selectionReason, "app_server_only_operation");
    assert.strictEqual(preview.selectionMode, "through_turn");
    assert.strictEqual(preview.throughTurnId, "turn-1");
    assert.strictEqual(preview.requestedDropTurns, 1);
    assert.strictEqual(preview.appliedDropTurns, 1);
    assert.strictEqual(preview.remainingTurnCount, 1);
    assert.strictEqual(preview.selectedTurn.turnId, "turn-1");
    assert.strictEqual(preview.droppedTurns.length, 1);
    assert.strictEqual(preview.droppedTurns[0].turnId, "turn-2");
    assert.strictEqual(preview.remainingTurns.length, 1);
    assert.strictEqual(preview.remainingTurns[0].turnId, "turn-1");
  });

  it("builds prune candidates from the newest turns in a thread snapshot", () => {
    const candidates = buildPruneTurnCandidates({
      id: "019d-thread-candidates",
      preview: "Prune exact history",
      cwd: "/repo",
      status: { type: "completed", activeFlags: [] },
      turns: [
        {
          id: "turn-1",
          startedAt: 1710000000,
          completedAt: 1710000010,
          status: "completed",
          items: [
            {
              id: "item-1",
              type: "userMessage",
              content: [{ type: "input_text", text: "keep this turn" }],
            },
          ],
        },
        {
          id: "turn-2",
          startedAt: 1710000100,
          completedAt: 1710000110,
          status: "completed",
          items: [
            {
              id: "item-2",
              type: "userMessage",
              content: [{ type: "input_text", text: "drop this turn" }],
            },
          ],
        },
      ],
    }, null, {
      limit: 1,
    });

    assert.strictEqual(candidates.source.selectionReason, "app_server_only_operation");
    assert.strictEqual(candidates.originalTurnCount, 2);
    assert.strictEqual(candidates.candidateCount, 1);
    assert.strictEqual(candidates.candidates[0].turnId, "turn-2");
    assert.strictEqual(candidates.candidates[0].position, 2);
    assert.strictEqual(candidates.candidates[0].newerTurns, 0);
  });
});
